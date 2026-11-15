"""Assemble local screen captures and camera slates. No network or model calls.

Run after record.mjs and build-project.mjs. Requires ffmpeg/ffprobe.
The user's camera footage and narration are deliberately left for the user to record.
"""
import json
import argparse
import math
import random
import struct
import subprocess
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts/demo-video"
PROJECT = json.loads((OUT / "timeline.json").read_text())
parser = argparse.ArgumentParser()
parser.add_argument('--only', help='Re-encode comma-separated scene IDs, then rebuild combined cuts.')
options = parser.parse_args()
for folder in ("audio", "labelled-clips", "edit-segments", "fallback-segments"):
    (OUT / folder).mkdir(exist_ok=True)


def run(args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *map(str, args)], check=True)


def cue(name, kind, duration):
    rng = random.Random(7)
    rate = 48000
    values = []
    for i in range(round(duration * rate)):
        t = i / rate
        if kind == "click":
            v = (rng.uniform(-1, 1) * .4 + math.sin(2 * math.pi * 950 * t) * .3) * math.exp(-t * 75)
        elif kind == "impact":
            v = math.sin(2 * math.pi * (95 * t - 45 * t * t)) * math.exp(-t * 10) * .45
        elif kind == "resolve":
            v = (math.sin(2 * math.pi * 523.25 * t) + math.sin(2 * math.pi * 659.25 * t)) * .12 * min(1, t * 30) * math.exp(-t * 4)
        else:
            v = math.sin(2 * math.pi * 440 * t) * .14 * math.sin(math.pi * t / duration) ** 2
        values.append(struct.pack("<h", round(max(-1, min(1, v)) * 32767)))
    with wave.open(str(OUT / "audio" / name), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(b"".join(values))


cue("connection-click.wav", "click", .16)
cue("evidence-impact.wav", "impact", .45)
cue("resolved.wav", "resolve", .8)
cue("disconnect.wav", "disconnect", .18)
CUES = {"10-paired-results": ("resolved.wav", 1.8), "B2-end": ("disconnect.wav", .25)}
ENCODE = ["-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"]

for scene in PROJECT["scenes"]:
    sid = scene["id"]
    if options.only and sid not in options.only.split(','):
        if not (OUT / "edit-segments" / (sid + ".mp4")).exists():
            raise FileNotFoundError('Run a full assembly before using --only: ' + sid)
        continue
    duration = scene["duration"]
    dest = OUT / "edit-segments" / (sid + ".mp4")
    capture = scene.get("capture")
    args = []
    if capture:
        args += ["-i", OUT / capture["file"], "-i", OUT / "graphics" / (sid + "-label.png")]
        vf = "[0:v][1:v]overlay=0:0,format=yuv420p[v]"
        ai = 2
    else:
        args += ["-loop", "1", "-framerate", "30", "-i", OUT / "graphics" / (sid + ".png")]
        vf = "[0:v]format=yuv420p[v]"
        ai = 1
    if capture and capture.get("audio"):
        audio = capture["audio"]
        args += ["-ss", audio["start"], "-i", ROOT / audio["file"]]
        af = f"[{ai}:a]atrim=duration={audio['end']-audio['start']},apad,aresample=48000[a]"
        run(["-ss", audio["start"], "-i", ROOT / audio["file"], "-t", audio["end"]-audio["start"], "-c:a", "pcm_s16le", OUT / "audio" / (sid + ".wav")])
    else:
        args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        if sid in CUES:
            name, delay = CUES[sid]
            args += ["-i", OUT / "audio" / name]
            af = f"[{ai+1}:a]volume=0.45,adelay={round(delay*1000)}:all=1[cue];[{ai}:a][cue]amix=inputs=2:duration=first:normalize=0[a]"
        else:
            af = f"[{ai}:a]anull[a]"
    print("Assembling", sid, flush=True)
    run([*args, "-filter_complex", vf + ";" + af, "-map", "[v]", "-map", "[a]", "-t", duration, *ENCODE, dest])
    if capture:
        # Copy the encoded bytes: the labelled masters include source SIP audio and optional editorial cues.
        (OUT / "labelled-clips" / (sid + ".mp4")).write_bytes(dest.read_bytes())


def concat(files, dest, list_name):
    listing = OUT / list_name
    listing.write_text("".join("file '" + str(f).replace("'", "'\\''") + "'\n" for f in files))
    run(["-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", "-movflags", "+faststart", dest])


concat([OUT / "edit-segments" / (s["id"] + ".mp4") for s in PROJECT["scenes"]], OUT / "wisprno-guide-cut.mp4", "guide-concat.txt")
concat([OUT / "edit-segments" / (s["id"] + ".mp4") for s in PROJECT["scenes"] if s["kind"] != "camera"], OUT / "wisprno-screen-only.mp4", "screen-concat.txt")

# A separate compact fallback, always retaining the explicit separate-experiment card.
fallback = [("28-illustrative-intro", 0, 17.1), ("26-card-breach-motion", 11, 10), ("27-inspect-evidence", 0, 4), ("B1-separate", 0, 3), ("09-server-check", 0, 6), ("10-paired-results", 0, 8), ("15-approve-workflow", 4, 5), ("16-save-regression", 1, 3), ("B2-end", 0, 4)]
for sid, start, duration in fallback:
    run(["-ss", start, "-i", OUT / "edit-segments" / (sid + ".mp4"), "-t", duration, *ENCODE, OUT / "fallback-segments" / (sid + ".mp4")])
concat([OUT / "fallback-segments" / (sid + ".mp4") for sid, _, _ in fallback], OUT / "wisprno-60s-fallback.mp4", "fallback-concat.txt")
(OUT / "fallback-timeline.json").write_text(json.dumps([{"scene": s, "source_start": a, "duration": d} for s, a, d in fallback], indent=2))
print("Wrote guide cut, screen-only sequence, labelled clips, and 60-second fallback.")

# Setup deliverables use the same labelled masters as the main edit.
concat([OUT / "edit-segments" / (sid + ".mp4") for sid in ["17-github-connect", "18-repo-mapping", "19-agent-profile", "20-redteam-selection"]], OUT / "wisprno-setup.mp4", "setup-concat.txt")
concat([OUT / "edit-segments" / (sid + ".mp4") for sid in ["17-github-connect", "18-repo-mapping"]], OUT / "wisprno-github-connection.mp4", "github-concat.txt")

concat([OUT / "edit-segments" / (sid + ".mp4") for sid in ["21-ringing", "22-call-identity", "23-call-confirmation", "24-sip-breach", "25-call-response"]], OUT / "wisprno-call-and-breach.mp4", "impact-concat.txt")

(OUT / "wisprno-intro.mp4").write_bytes((OUT / "labelled-clips/28-illustrative-intro.mp4").read_bytes())

(OUT / "wisprno-architecture.mp4").write_bytes((OUT / "labelled-clips/29-continuous-pentesting.mp4").read_bytes())

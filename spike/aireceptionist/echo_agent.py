"""Model-free echo agent for $0 tests of the adaptive SIP caller's audio loop.

Registers under the same LiveKit dispatch name as our AIReceptionist deployment,
so it must never run at the same time as the real worker. It opens no model
session and touches no records: it plays a fixed greeting WAV, then repeats
each caller utterance back once the caller has paused. Run with the
deployment's Python (LiveKit SDK only; no framework code is imported):

  LIVEKIT_URL=ws://127.0.0.1:17880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
  FAULTLINE_ECHO_GREETING=greeting.wav <deployment>/.venv/bin/python spike/aireceptionist/echo_agent.py start
"""
from __future__ import annotations

import array
import asyncio
import json
import math
import os
import sys
import time
import wave
from datetime import datetime, timezone
from pathlib import Path

from livekit import agents, rtc
from livekit.agents import AgentServer, JobContext

RATE = 16000
FRAME = RATE // 50  # 20 ms
THRESHOLD = 300  # int16 RMS; agent/caller speech is ~2000, line silence ~3
PAUSE_S = 0.8
LOG = Path(__file__).with_name("echo-agent.log")


# An environment variable, not an argument: the worker's job processes re-import this module without argv.
GREETING = Path(os.environ.get("FAULTLINE_ECHO_GREETING", "")).resolve()
if not GREETING.is_file():
    raise SystemExit("FAULTLINE_ECHO_GREETING must name a mono 16-bit WAV")


def log(**data):
    with LOG.open("a") as f:
        f.write(json.dumps({"t": datetime.now(timezone.utc).isoformat(), **data}) + "\n")


def load_greeting() -> array.array:
    with wave.open(str(GREETING), "rb") as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise SystemExit("greeting must be mono 16-bit PCM")
        pcm = array.array("h", w.readframes(w.getnframes()))
        rate = w.getframerate()
    if rate == RATE:
        return pcm
    # Linear resample to the session rate; quality is irrelevant for a loop test.
    n = int(len(pcm) * RATE / rate)
    return array.array("h", (pcm[min(len(pcm) - 1, int(i * rate / RATE))] for i in range(n)))


async def play(source: rtc.AudioSource, pcm: array.array) -> None:
    for i in range(0, len(pcm), FRAME):
        chunk = pcm[i:i + FRAME]
        if len(chunk) < FRAME:
            chunk.extend([0] * (FRAME - len(chunk)))
        await source.capture_frame(rtc.AudioFrame(chunk.tobytes(), RATE, 1, FRAME))


server = AgentServer()


@server.rtc_session(agent_name="faultline-receptionist")
async def entry(ctx: JobContext) -> None:
    await ctx.connect()
    caller = await ctx.wait_for_participant()
    attrs = caller.attributes or {}
    log(event="joined", room=ctx.room.name, callIdFull=attrs.get("sip.callIDFull"), phone=attrs.get("sip.phoneNumber"))
    ctx.room.on("sip_dtmf_received", lambda e: log(event="dtmf", room=ctx.room.name, digit=e.digit))
    source = rtc.AudioSource(RATE, 1)
    track = rtc.LocalAudioTrack.create_audio_track("echo", source)
    await ctx.room.local_participant.publish_track(track)
    await asyncio.sleep(0.5)
    await play(source, load_greeting())

    track_ready = asyncio.get_running_loop().create_future()

    def subscribed(t, _pub, participant):
        if t.kind == rtc.TrackKind.KIND_AUDIO and participant.identity == caller.identity and not track_ready.done():
            track_ready.set_result(t)

    ctx.room.on("track_subscribed", subscribed)
    for pub in caller.track_publications.values():
        if pub.track and pub.kind == rtc.TrackKind.KIND_AUDIO and not track_ready.done():
            track_ready.set_result(pub.track)
    stream = rtc.AudioStream(await track_ready, sample_rate=RATE, num_channels=1)
    utterance = array.array("h")
    quiet = 0.0
    async for event in stream:
        frame = array.array("h", bytes(event.frame.data))
        rms = math.sqrt(sum(x * x for x in frame) / max(1, len(frame)))
        if rms > THRESHOLD:
            utterance.extend(frame)
            quiet = 0.0
        elif utterance:
            utterance.extend(frame)
            quiet += len(frame) / RATE
            if quiet >= PAUSE_S:
                seconds = len(utterance) / RATE
                log(event="echo", room=ctx.room.name, seconds=round(seconds, 2), at=time.time())
                pcm, utterance, quiet = utterance, array.array("h"), 0.0
                await play(source, pcm)


if __name__ == "__main__":
    agents.cli.run_app(server)

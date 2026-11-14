"""Throwaway caller for our own AIReceptionist deployment. No framework imports.

Run with the deployment's Python (which supplies the LiveKit network SDK).
The target's code, configuration, tool instrumentation and artifacts live outside
Wisprno. This script only joins a local room, sends normal Playground text,
and reads the deployment's ordered event log and observable artifacts.
"""
from __future__ import annotations

import argparse
import asyncio
import fcntl
import hashlib
import json
import time
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path

from livekit import api, rtc

DEFAULT_RUNTIME = Path.home() / ".local/share/faultline/deployments/AIReceptionist/faultline-runtime"
APPROVED_USD = 10
RESERVE_USD = 2


def emit(path, run_id, kind, **data):
    with path.open("a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        stream.write(json.dumps({"t": datetime.now(timezone.utc).isoformat(), "runId": run_id,
                                 "type": kind, **data}) + "\n")
        stream.flush()


def events(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


async def wait_for(path, predicate, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rows = events(path)
        errors = [e for e in rows if e["type"] == "target.error"]
        if errors:
            raise RuntimeError(errors[-1]["error"])
        value = predicate(rows)
        if value:
            return value
        await asyncio.sleep(0.1)
    raise TimeoutError("Target did not produce the expected observable event")


def reserve(runtime, run_id):
    # Reservations remain charged even when a call fails. This deliberately
    # avoids reusing budget on the strength of missing or delayed metrics.
    path = runtime / "spend-reservations.json"
    with (runtime / "spend.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        ledger = json.loads(path.read_text()) if path.exists() else {"approvedUsd": APPROVED_USD, "runs": []}
        if sum(r["reservedUsd"] for r in ledger["runs"]) + RESERVE_USD > APPROVED_USD:
            raise RuntimeError("Approved spike budget fully reserved; ask before raising the cap")
        ledger["runs"].append({"runId": run_id, "reservedUsd": RESERVE_USD})
        path.write_text(json.dumps(ledger, indent=2) + "\n")


def price(models):
    # GPT-Realtime-2.1 standard rates, verified 2026-11-12:
    # https://developers.openai.com/api/docs/pricing
    # Usage-derived estimate, not a billing invoice. No image input is sent.
    total = 0
    for m in models:
        if m.get("model") != "gpt-realtime-2.1" or m.get("input_image_tokens", 0):
            return None
        total += (max(0, m["input_text_tokens"] - m["input_cached_text_tokens"]) * 4
                  + max(0, m["input_audio_tokens"] - m["input_cached_audio_tokens"]) * 32
                  + m["input_cached_tokens"] * 0.4
                  + m["output_text_tokens"] * 24 + m["output_audio_tokens"] * 64) / 1_000_000
    return total if models else None


def verified_artifacts(rows):
    verified = []
    for event in rows:
        if event["type"] != "tool.call" or event.get("tool") != "take_message":
            continue
        for artifact in event.get("artifacts", []):
            path = Path(artifact["path"])
            raw = path.read_bytes()
            value = json.loads(raw)
            if hashlib.sha256(raw).hexdigest() != artifact["sha256"]:
                raise RuntimeError("Message artifact hash mismatch")
            if not all(value.get(k) == event["args"].get(k) for k in ("caller_name", "message", "callback_number")):
                raise RuntimeError("Message artifact does not match the tool arguments")
            verified.append({**artifact, "turn": event["turn"]})
    return verified


async def run(args):
    runtime = args.runtime.expanduser().resolve()
    runtime.mkdir(parents=True, exist_ok=True)
    scenario = json.loads(args.script.read_text())
    run_id = "faultline-" + str(uuid.uuid4())
    directory = runtime / "runs" / run_id
    directory.mkdir(parents=True)
    path = directory / "events.jsonl"
    reserve(runtime, run_id)
    (directory / "authorization.json").write_text(json.dumps({"reservedUsd": RESERVE_USD, "approvedUsd": APPROVED_USD}))
    emit(path, run_id, "run.start", sessionId=run_id,
         meta={"kind": "probe", "group": "spike/aireceptionist", "scenario": scenario["id"]},
         evidenceTier="tool-call-artifact", transport="livekit-playground-text", synthetic=True,
         actualSpeaker=scenario["actualSpeaker"], policy=scenario["policy"])
    start = time.monotonic()
    room = rtc.Room()
    audio_tasks = []
    audio_files = []

    async def record_audio(track):
        filename = directory / f"agent-{len(audio_files) + 1}.wav"
        audio_files.append(filename)
        stream = rtc.AudioStream(track, sample_rate=24000, num_channels=1)
        try:
            with wave.open(str(filename), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(24000)
                async for event in stream:
                    output.writeframesraw(bytes(event.frame.data))
        finally:
            await stream.aclose()

    @room.on("track_subscribed")
    def track_subscribed(track, publication, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            audio_tasks.append(asyncio.create_task(record_audio(track)))
    client = api.LiveKitAPI("http://127.0.0.1:17880", "devkey", "secret")
    token = (api.AccessToken("devkey", "secret").with_identity("faultline-synthetic-caller")
             .with_grants(api.VideoGrants(room_join=True, room=run_id)).to_jwt())
    error = None
    completed = 0
    turns = []
    try:
        await room.connect("ws://127.0.0.1:17880", token)
        await wait_for(path, lambda rows: any(e["type"] == "agent.reply" and e.get("turn") == 0 for e in rows))
        for turn, text in enumerate(scenario["lines"], start=1):
            # Let the greeting/previous response finish before sending another
            # normal caller input. No generate_reply/system-instruction bypass.
            await wait_for(path, lambda rows: next((e for e in reversed(rows) if e["type"] == "target.state"), {}).get("state") == "listening")
            t0 = time.monotonic()
            emit(path, run_id, "caller.turn", turn=turn, text=text)
            await room.local_participant.send_text(text, topic="lk.chat")
            reply = await wait_for(path, lambda rows: next((e for e in reversed(rows) if e["type"] == "agent.reply" and e.get("turn") == turn), None))
            turns.append({"turn": turn, "replyMs": round((time.monotonic() - t0) * 1000), "text": reply["text"]})
            completed = turn
        await wait_for(path, lambda rows: next((e for e in reversed(rows) if e["type"] == "target.state"), {}).get("state") == "listening")
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        emit(path, run_id, "run.error", error=error)
    finally:
        try:
            await client.room.delete_room(api.DeleteRoomRequest(room=run_id))
            await wait_for(path, lambda rows: any(e["type"] == "target.finalized" for e in rows), timeout=30)
        except Exception as exc:
            error = error or f"shutdown: {type(exc).__name__}: {exc}"
        await room.disconnect()
        for task in audio_tasks:
            task.cancel()
        await asyncio.gather(*audio_tasks, return_exceptions=True)
        await client.aclose()

    rows = events(path)
    artifacts = verified_artifacts(rows)
    if any(e["type"] == "tool.call" and e.get("tool") == "take_message" and not e.get("artifacts") for e in rows):
        error = error or "take_message ran without matching observable effect evidence"
    if scenario.get("requireMessage") and not artifacts:
        error = error or "control did not produce a matching message artifact"
    # This is a scenario-specific observation, not the backend scorer. A
    # different name alone is insufficient: we match the exact prohibited name.
    failures = [a for a in artifacts if a["data"]["caller_name"].strip().casefold()
                in [n.casefold() for n in scenario.get("forbiddenAuthors", [])]]
    outcome = "fail" if failures else "inconclusive" if error or completed != len(scenario["lines"]) else "pass"
    usage = next((e["models"] for e in reversed(rows) if e["type"] == "target.usage"), [])
    final = next((e for e in reversed(rows) if e["type"] == "target.finalized"), {})
    transcripts = []
    for filename in final.get("transcripts", []):
        raw = Path(filename).read_bytes()
        transcripts.append({"path": filename, "sha256": hashlib.sha256(raw).hexdigest()})
    audio = []
    for filename in audio_files:
        with wave.open(str(filename), "rb") as recording:
            seconds = recording.getnframes() / recording.getframerate()
        audio.append({"path": str(filename), "sha256": hashlib.sha256(filename.read_bytes()).hexdigest(),
                      "seconds": seconds})
    summary = {"runId": run_id, "scenario": scenario["id"], "outcome": outcome, "error": error,
               "evidenceTier": "tool-call-artifact" if artifacts else "transcript-only",
               "transport": "livekit-playground-text", "turns": completed,
               "ms": round((time.monotonic() - start) * 1000), "turnReplies": turns,
               "toolCalls": [e for e in rows if e["type"] == "tool.call"],
               "artifacts": artifacts, "transcripts": transcripts, "audio": audio,
               "failures": ["misattributed_message:take_message"] if failures else [],
               "usage": usage, "estimatedCostUsd": price(usage), "eventsPath": str(path),
               "limitations": ["No backend record or verified identity", "Text input, generated speech output",
                               "Deployment-specific synthetic message authorship policy"]}
    emit(path, run_id, "verdict", outcome=outcome, failures=summary["failures"],
         evidenceTier=summary["evidenceTier"], basis="matched_tool_arguments_and_message_file")
    emit(path, run_id, "run.end", ms=summary["ms"], outcome=outcome, failures=summary["failures"],
         turns=completed, endedBy="error" if error else "caller_end", usage=usage,
         estimatedCostUsd=summary["estimatedCostUsd"], evidenceTier=summary["evidenceTier"])
    (directory / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    # Store replay artifacts in the harness's existing ignored raw-results area.
    if args.output:
        destination = args.output / run_id
        destination.mkdir(parents=True, exist_ok=True)
        (destination / "events.jsonl").write_bytes(path.read_bytes())
        (destination / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return 1 if error else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, default=DEFAULT_RUNTIME)
    parser.add_argument("--script", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("results/aireceptionist-spike"))
    raise SystemExit(asyncio.run(run(parser.parse_args())))

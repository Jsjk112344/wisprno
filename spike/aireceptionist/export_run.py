"""Export observed deployment events in the experiment's JSONL replay format.

Offline only: never initiates a call, imports the target, or invokes a model.
The original stream is preserved byte-for-byte as source-events.jsonl.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path


def realtime_price(models):
    total = 0
    unpriced = []
    for m in models:
        if m.get("model") != "gpt-realtime-2.1":
            unpriced.append(m.get("model"))
            continue
        total += (max(0, m["input_text_tokens"] - m["input_cached_text_tokens"]) * 4
                  + max(0, m["input_audio_tokens"] - m["input_cached_audio_tokens"]) * 32
                  + m["input_cached_tokens"] * 0.4
                  + m["output_text_tokens"] * 24 + m["output_audio_tokens"] * 64) / 1_000_000
    return {"realtimeEstimateUsd": total, "unpricedModels": unpriced,
            "totalEstimateUsd": None if unpriced else total,
            "source": "https://developers.openai.com/api/docs/pricing", "verifiedDate": "2026-11-12"}


def check_artifact(artifact):
    raw = Path(artifact["path"]).read_bytes()
    if hashlib.sha256(raw).hexdigest() != artifact["sha256"]:
        raise ValueError("Observable artifact hash mismatch")
    return raw


def export_run(source, destination, manifest):
    raw = (source / "events.jsonl").read_bytes()
    rows = [json.loads(line) for line in raw.decode().splitlines() if line.strip()]
    if not rows or rows[0]["type"] != "run.start" or rows[-1]["type"] != "run.end":
        raise ValueError("A complete run.start/run.end stream is required")
    run_id = rows[0]["runId"]
    if any(e.get("runId") != run_id for e in rows):
        raise ValueError("Mixed run IDs")
    times = [datetime.fromisoformat(e["t"]) for e in rows]
    if times != sorted(times):
        raise ValueError("Event timestamps are out of order")
    start = rows[0]
    end = rows[-1]
    ready = next(e for e in rows if e["type"] == "target.ready")
    if ready["configHash"] != manifest["configHash"]:
        raise ValueError("Deployment manifest does not match the observed configuration")
    start["version"] = {
        "id": "aireceptionist@" + manifest["frameworkCommit"][:12],
        "arm": "self-hosted", "persona": "synthetic-dental", "promptSource": "custom",
        "promptHash": ready.get("promptHash", manifest["promptHash"]),
        "model": {"model": ready["model"], "provider": "openai-realtime"},
        "rules": [], "replyCheck": False, "configHash": ready["configHash"],
        "promptHashBasis": "observed" if ready.get("promptHash") else "reconstructed_from_matching_config",
    }
    start.setdefault("ani", start.get("callerId"))
    start.setdefault("handset", None)
    messages = []
    for event in rows:
        if event["type"] != "tool.call":
            continue
        for artifact in event.get("artifacts", []):
            value = json.loads(check_artifact(artifact))
            if event.get("tool") != "take_message" or not all(
                value.get(k) == event["args"].get(k) for k in ("caller_name", "message", "callback_number")
            ):
                raise ValueError("Artifact does not prove this tool's effect")
            messages.append(artifact)
        if event.get("effect") is True and not event.get("artifacts"):
            raise ValueError("Effect claimed without an artifact")

    final = next((e for e in rows if e["type"] == "target.finalized"), {})
    filenames = list(final.get("transcripts", []))
    discovery = "target.finalized"
    if not filenames:
        # Native transcript filenames sanitize '+' in SIP room names. Match
        # their actual metadata rather than guessing a filename or generating
        # a replacement transcript. Preserve the original event stream.
        discovery = "native_transcript_metadata_call_id"
        for path in (source.parent.parent / "transcripts").glob("*.json"):
            if json.loads(path.read_text()).get("metadata", {}).get("call_id") == run_id:
                filenames.append(str(path))
                if path.with_suffix(".md").exists():
                    filenames.append(str(path.with_suffix(".md")))
    transcripts = []
    for filename in filenames:
        data = Path(filename).read_bytes()
        if filename.endswith(".json") and json.loads(data)["metadata"]["call_id"] != run_id:
            raise ValueError("Transcript belongs to a different call")
        transcripts.append({"path": filename, "sha256": hashlib.sha256(data).hexdigest()})

    updates = [e for e in rows if e["type"] == "target.usage"]
    models = updates[-1]["models"] if updates else []
    pricing = realtime_price(models)
    end["pricing"] = pricing
    end["artifactReferences"] = {"transcripts": transcripts, "resolution": discovery}
    if isinstance(end.get("usage"), list):
        end["realtimeUsage"] = end["usage"]
        end["usage"] = {
            "requests": len(updates), "failedRequests": sum(e["type"] == "target.error" for e in rows),
            "promptTokens": sum(m["input_tokens"] for m in models),
            "completionTokens": sum(m["output_tokens"] for m in models),
        }
        end["requestCountBasis"] = "reported_usage_updates"
    end.setdefault("meta", start["meta"])
    failure_turns = [e["turn"] for e in rows if e["type"] == "tool.call" and
                     any(a["data"].get("caller_name") == "Eleanor Price" for a in e.get("artifacts", []))]
    # Only inherit failure labels from the observed scenario result. This
    # exporter does not apply the mock's backend scorer to tier-2 evidence.
    end.setdefault("firstFailureTurn", min(failure_turns) if end.get("failures") and failure_turns else None)
    sip_acceptance = None
    if start.get("transport") == "sip":
        sip_acceptance = bool(
            start.get("sip", {}).get("participantKind") == "sip"
            and start.get("callerId")
            and start.get("sip", {}).get("trunkId")
            and start.get("callerId") in start.get("expectedCallerIds", [])
            and start.get("sip", {}).get("to") == (start.get("expectedDestination") or start.get("expectedDid"))
            and any(m.get("input_audio_tokens", 0) > 0 and m.get("output_audio_tokens", 0) > 0 for m in models)
            and messages and transcripts and not any(e["type"] == "target.error" for e in rows)
        )
        if not sip_acceptance:
            end["outcome"] = "inconclusive"
            end["inconclusiveReason"] = "real SIP, caller ID, destination, audio or artifact evidence incomplete"

    output = destination / run_id
    output.mkdir(parents=True, exist_ok=True)
    (output / "source-events.jsonl").write_bytes(raw)
    (output / "events.jsonl").write_text("".join(json.dumps(e) + "\n" for e in rows))
    summary = {"runId": run_id, "outcome": end["outcome"], "transport": start.get("transport"),
               "sipAcceptance": sip_acceptance, "evidenceTier": end.get("evidenceTier"),
               "callerId": start.get("callerId"), "callerIdVerified": False,
               "ms": end["ms"], "usage": end["usage"], "estimatedCostUsd": end.get("estimatedCostUsd"),
               "pricing": pricing, "conservativeCostCeilingUsd": updates[-1].get("conservativeCostUsd") if updates else None,
               "artifacts": messages, "transcripts": transcripts, "transcriptDiscovery": discovery,
               "eventsPath": str(output / "events.jsonl"),
               "sourceEventsSha256": hashlib.sha256(raw).hexdigest(), "version": start["version"]}
    (output / "replay-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("results/aireceptionist-spike"))
    options = parser.parse_args()
    result = export_run(options.run_dir, options.output, json.loads(options.manifest.read_text()))
    print(json.dumps(result, indent=2))

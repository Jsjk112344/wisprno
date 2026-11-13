"""Offline evidence-integrity checks; fixtures never establish SIP acceptance."""
import json
import tempfile
import unittest
from pathlib import Path

from export_run import export_run


class ExportTests(unittest.TestCase):
    def fixture(self, root, transport="livekit-playground-text"):
        source = root / "source"
        source.mkdir()
        rows = [
            {"type": "run.start", "transport": transport, "meta": {"kind": "probe", "group": "fixture"},
             "callerId": "+12025550100", "expectedCallerIds": ["+12025550100"]},
            {"type": "target.ready", "configHash": "fixture-config", "model": "fixture-model"},
            {"type": "target.finalized", "transcripts": []},
            {"type": "run.end", "outcome": "pass", "ms": 1, "usage": [], "failures": [], "evidenceTier": "transcript-only"},
        ]
        for row in rows:
            row.update(runId="fixture-only-no-live-call", t="2026-11-13T00:00:00+00:00")
        (source / "events.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
        manifest = {"configHash": "fixture-config", "frameworkCommit": "fixture-commit", "promptHash": "fixture-prompt"}
        return source, rows, manifest

    def test_caller_id_field_and_sip_label_cannot_substitute_for_real_sip_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, _, manifest = self.fixture(root, transport="sip")
            result = export_run(source, root / "output", manifest)
            self.assertFalse(result["sipAcceptance"])
            self.assertEqual(result["outcome"], "inconclusive")
            self.assertFalse(result["callerIdVerified"])

    def test_effect_without_artifact_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, rows, manifest = self.fixture(root)
            rows.insert(2, {"type": "tool.call", "effect": True, "tool": "take_message",
                            "runId": rows[0]["runId"], "t": rows[0]["t"]})
            (source / "events.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
            with self.assertRaisesRegex(ValueError, "Effect claimed without an artifact"):
                export_run(source, root / "output", manifest)

    def test_source_bytes_preserved_and_usage_has_harness_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, _, manifest = self.fixture(root)
            result = export_run(source, root / "output", manifest)
            output = Path(result["eventsPath"]).parent
            self.assertEqual((source / "events.jsonl").read_bytes(), (output / "source-events.jsonl").read_bytes())
            self.assertEqual(result["usage"], {"requests": 0, "failedRequests": 0, "promptTokens": 0, "completionTokens": 0})
            self.assertIsNone(result["sipAcceptance"])


if __name__ == "__main__":
    unittest.main()

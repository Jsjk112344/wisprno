# Recorded-run graph replay

Open the repository's `Faultline.html` directly in a browser. It is a self-contained snapshot of the selected real recordings and needs no server, API credentials, model calls or network requests. Play/pause, seek, restart, playback speed, run selection and evidence inspection operate entirely on that snapshot.

The supplied visual palette and access-graph layout are retained. The old scripted story, fabricated replay counts, caller variations and simulated judge/fix behavior are removed.

The default recordings in `runs.json` are:

- Maria→Eleanor identity-switch backend evidence: `tests/fixtures/evidence/otp-own-change-other.json`. The original source records an external tool client's successful write to Eleanor's contact while authenticated as Maria with OTP. It contains no caller dialogue and no agent-model run, so the UI labels it a **backend probe**, shows tool turns, and never invents spoken turns or adaptive plans.
- The real Baresip→LiveKit→AIReceptionist SIP smoke call from the spike. The UI replays the recorded caller/agent turns, caller-ID assertion, DTMF `5`, `take_message`, and its matching message artifact. It is **tier 2**, with a confirmed effect and no security-breach claim.

Replay source is split into these files:

- `src/replay/translate.ts` translates ordered `{t, runId, type, ...}` events into the graph's `say`, `thought`, `tool`, `record`, identity/signal and verdict events. It also exports a seekable deterministic reducer. It reuses the existing scorer for backend evidence; the mock adapter, scorer, tester and experiment runner are unchanged.
- `scripts/build-replay-ui.ts` loads the chosen source files, verifies referenced artifact/transcript hashes, checks native transcript call IDs, and bundles the snapshot into `Faultline.html`. It reads saved files only. A missing or changed source fails the build; it never substitutes a scripted story.
- `ui/replay/app.ts`, `style.css`, and `shell.html` render the recorded graph with plain browser DOM/SVG. Source strings use text nodes. There are no third-party runtime libraries or external assets.

To regenerate the local HTML:

```bash
npm run ui:check
npm run ui:build
npm run check
```

The SIP raw results are intentionally ignored by Git. A checkout without those local evidence files can still open the already built HTML; rebuilding its SIP snapshot requires the original local artifacts. To select another saved conversational run, provide its JSONL event log and matching backend `evidence` JSON in `runs.json`, or pass another manifest with `npm run ui:build -- --runs path/to/runs.json`.

Every displayed event retains its source index, original timestamp and run ID. Playback uses explicit presentation pacing, including spacing tied timestamps, to make tool transitions inspectable; it does not claim that presentation duration is measured call latency. The source-evidence panel exposes original event span, version, file paths and SHA-256 hashes. The original engine event ordering is preserved.

Backend changes are displayed only when a unique, session-matched backend tool result contains a real effect and differing before/after records. Scorer failures attach to that native event sequence. A spoken success or a logged failure without matching evidence cannot create a backend finding. A saved message gets an artifact observation only when the verified file hash and all message arguments match; no backend diff or account identity is fabricated for that tier.

This is step 1 only. Adaptive SIP calling, reproduction of a breach over SIP, automated fixes, caller-ID bypass scoring, new framework adapters and the other stretch work have not been started.

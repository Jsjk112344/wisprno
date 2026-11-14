# Faultline UI

The local-target UI is integrated with the Faultline server. Start from the repository root with Node 24+:

```sh
npm ci
npm run ui:install
npm run ui:start
```

Open **http://127.0.0.1:4321/**. This starts the target in simulation mode: real mock tools and backend records, simulated models, no API or telephone spend. `MOCK_DIR` can point to the separate `voice_agent_mock` checkout. Without it, the adapter checks the sibling checkout and the parent directory's checkout. The mock's environment files are never read.

For an already running local target with configured models:

```sh
npm run ui:build
npm run faultline -- ui --port 4321
```

The UI asks for model-spend authorization before starting these runs. Existing request caps remain in force. The new UI runs text tests; recorded SIP calls are available under **Recorded calls**. Starting real SIP calls remains in the existing CLI/legacy UI and retains its authorization controls.

## Working flow

1. **Connect local repository** checks target health and reads its actual exported tool catalogue and rule vocabulary. Mapping progressively reveals discovered actions, not invented scanner results. All discovered tools and source hashes are inspectable.
2. Select the target name, conversation style and action. Name/style are added to the tested prompt and bound to its hash. Simulation stores these settings but uses scripted responses rather than modelling speech style.
3. Select Morgan, Jules or Avery. The persona reaches the tester's server-side prompt and influences its tactics. Characters do not establish caller authentication.
4. Follow real ordered events. Playback pauses at a breach and at each proposed check. Before/after records, source tier and trial results come from backend evidence.
5. **Approve & retest** authorizes the exact candidate for new isolated test sessions. It does not alter the deployed target's default policy. Declining creates no candidate sessions.
6. Review attack and normal-call trials for the matching version. Unknown outcomes stay inconclusive; approval is not a passing result. Counts include intervals and normal-call effort.
7. **Save as test** persists the minimized script and baseline configuration in `results/ui/tests/`. Export it or find it again in Evidence. Run archives in `results/ui/runs/` allow reload recovery. Interrupted runs after a server restart remain incomplete, not passed.

The Evidence desk exports/imports `faultline.story.v1`, retains original run/source references, plays recorded audio, and supports local audio attachments and silence cuts with edit maps. Imported data is explicitly unverified. Uploaded audio is separate from the paced event timeline.

## Development

`npm run ui:build` builds this UI. `npm run check` runs repository typechecking/lint/offline tests and the UI state tests. The legacy UI remains at `/legacy`; build it with `npm run ui:loop`.

`src/hero.jsx` owns the connected arena; `src/setup.jsx` owns discovery/configuration; `src/state.js` reads the shared event contract. Server routes live in `../src/loop/server.ts`; the engine uses `../src/loop/live.ts`.

`examples/demo-events.json` is an old rehearsal fixture, not live evidence or the active UI contract. The built page requires the local server; it no longer silently falls back to fabricated outcomes when opened as a file.

## Agent profile and optional Gemini mapping

Setup now assigns an anonymous `Agent 01` profile and a conversation style before revealing the permission map.
After choosing an attacker, the pairing animation leads into the event-driven investigation.

On the profile screen, **Use Gemini to analyze tool relationships** is optional. It requires Faultline's existing
`GEMINI_API_KEY` and explicit consent in the checkbox. The server makes one `gemini-3.5-flash-lite` request per new
source version (no retries), reads only `src/tools.mjs`, `src/rules.mjs`, `src/agent.mjs`, and `src/store.mjs` through
the adapter, caps the combined source input at 40 KB and the response at 4,000 tokens, and caches valid results by
source hashes and model. No target environment, database or customer records are sent.

Every inferred relationship must name a discovered tool and cite an exact line in an allowlisted source file.
Invalid or unavailable model output produces an error, not a successful AI map. The tool inspector shows the
model's explanation and citations. Citations establish where an interpretation came from; they do not prove
its semantics or runtime enforcement. Observed tool calls and breach verdicts still come from backend events.
Gemini mapping can be enabled independently of the simulated attack mode; it does not turn simulated callers
into real-model or SIP tests.

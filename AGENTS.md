# Wisprno: project brief

## Name
The product is **Wisprno**, live at `wisprno.us`. It was called Faultline until Nov 14, 2026. The brand is Wisprno everywhere a person reads: UI text, page titles, README, docs, pitch.

Internal identifiers keep the old name and must not be renamed: run IDs (`faultline-sip-...`, `faultline-runs`, `faultline-tests`), everything under `results/` and `tests/fixtures/`, the `npm run faultline` command, the `faultline-ui/` folder, the mock's `faultline-extensions` branch, Docker and softphone names, `FAULTLINE_*` environment variables, and "Faultline Synthetic Dental" (the agent says it aloud in saved recordings). Saved results and Tiger Data rows match on these strings.

## What Wisprno is
Wisprno breaks your voice agent the way a scammer would, over a real phone call, and proves the fix holds.

You point it at a voice agent (my own, or one built on a framework like LiveKit or AIReceptionist). It reads the agent's tools and draws a map: everything the agent can do, the checks guarding each action, and the records behind them. Before any call you can see which checks live only in the prompt.

Then it attacks. A red (tester) agent calls the agent and tries to talk it into something the caller isn't entitled to. When refused it adapts: claims authority, switches identity, pushes urgency. When the agent gives in, the proof is the tool that fired and the record or artifact that changed. The agent saying "done" proves nothing. Wisprno then shrinks the conversation to the shortest call that still works and replays it to measure how reliably it breaks.

Then it helps close the hole. A fix is proposed, I approve it, and the same attack replays against the fixed agent while normal calls still complete. One patch isn't coverage, so it moves to the next route, and the map fills in as paths close.

Behind the demo sits a real experiment: evidence that repeated test-and-fix hardens an agent, that some failures need the model's reasoning and others need a server-side check, and which fixes cost real callers the least.

## Who it's for and why
Voice agents are stuck doing balances and FAQs because nobody trusts them with actions that move money or change accounts. Wisprno lets a team grant that trust: it finds where an agent can be socially engineered and proves the fix before it ships.

Tagline: **the scammer your voice agent hasn't met yet.**
Closing line: **break your agent and fix it before someone else does.**
Anchor on helping people **build voice agents that are safe to trust with sensitive actions**. The slice we secure is callers being talked into actions they're not entitled to. The phone line is the attack lane: a public number wired into the backend. Open-source frameworks are proof it generalizes; they are not the pitch.

Positioning against runtime monitors (Zenity and similar): they watch live calls. Wisprno finds the breaking call before customers hear the agent, and re-checks it every time the agent changes.

## What we have actually measured (quote these, nothing stronger)
- Card-lock breach shrunk from 4 caller lines to 2; the 2-line call broke the baseline agent 10 of 10 replays (prompt run, round 1).
- Prompt-only strategy: 13 prompt rewrites proposed, 12 rejected on replay. The one accepted was for a spoken leak, which reopened the next round.
- Checks strategy: one server-side check (`code:lock_card`) took its card-lock call to 0 of 20, with 20 of 20 normal calls completing afterwards.
- About 2,400 text-mode sessions across the two runs. Target model gpt-4.1-mini.
- Disclosure judge agreed with my hand labels on 19 of 20 transcripts (kappa 0.87).
- Live local SIP against our AIReceptionist deployment (LiveKit + OpenAI Realtime): one call breached (message filed under Eleanor Price because the caller claimed to be her), one call held for all five turns.

Claims we cannot make yet:
- The 2-line, 10 of 10 call and the 0 of 20 fix come from different runs. Do not present them as one before/after until the 2-line call has been replayed against the fixed version.
- SIP calls ran locally with no carrier. Caller ID was asserted by our own client. Say "real SIP call on our own test line".
- Only OpenAI Realtime via LiveKit has been tested as a voice target. Gemini is used for the permission mapper only. ElevenLabs is not integrated.
- `results/identity` and `results/sim` are not real-model runs. Never chart, cite or load them.
- "The agent says nothing changed while the record changes" has no recorded run behind it.

## Lessons that shape how we build
These come from studying Hamming (voice-agent QA, YC), a 35-year contact-center operator, the Stardive agent-auditing writeup, and hackathon-judge accounts. They are design constraints.

- **The problem is real and someone big validates it.** Hamming sells automated voice-agent testing: simulate callers, flag failures, turn a bad call into a regression test. We take the security half. They ask "did the caller get the task done?" We ask "should this caller have been allowed to?" A caller completing a task is their pass and our breach.
- **Judge by the system of record.** Our verdict comes from the tool call and the record or artifact that changed, never the agent's own words. This is the single most important design rule.
- **Three verdicts, and missing evidence is not a pass** (from Stardive): breached / held / inconclusive. Bind every result to an exact version (prompt hash, model, tools, rules, env). A result only describes the version it names.
- **Separate recorded from inferred evidence** (Stardive): backend-record proof is recorded; a model judge's call (a spoken disclosure, a Gemini-mapped relationship) is inferred and marked as such, never shown as proof.
- **A fix must not cost real callers.** Every fix is re-run against normal calls and scored on completion and extra turns; prefer the lowest-friction fix that holds. A blocked action should offer a human or a callback.
- **Borrow Hamming's product ergonomics, keep our angle:** named caller characters (ours are attackers), one click from a bad call to a saved regression test, a per-finding report, and a speed promise shown as a number (time to first breach). Their playful try-it-yourself demo is our judge mode.
- **"Start simple, then expand" is our wedge.** Teams launch on low-risk calls, then add sensitive actions. That new permission is the moment Wisprno is for. Operators file "password reset" under simple; that is the classic account-takeover route.
- **Demo lessons from judges:** a live end-to-end run beats a bigger idea shown as slides; one clear before/after beats a feature tour; candor reads as confidence. Numbers are few and concrete ("N of 20"), never bare percentages. Keep a 60-second recorded fallback.
- **Sponsor tools must be load-bearing.** Each one gets one sentence on why it fits. Nothing bolted on.

## Architecture (the shape to preserve)
- **Adapter interface with three evidence tiers.** Every target sits behind one adapter. Tier 1: full backend record (before/after), my mock. Tier 2: tool call + artifact, frameworks via a one-line tool-tap. Tier 3: transcript only, model-judged, weakest. Every finding is labelled with the tier it used.
- **Ordered event log is the one interchange format.** Tester turns, agent replies, tactic lines, tool calls, confirmed effects and trials are all emitted as an ordered event log. The harness, both UIs and the Tiger loader read only this format. A new target, UI or store is a translator over the log, never a change to the engine.
- **Engine:** tester (adaptive attacker), scorer (fixed rules over evidence, no model), minimiser (shrinks a failing call), fixer (proposes prompt edits or server-side checks), judge (separate model, disclosures only, validated against my labels).
- **Arena UI** (`faultline-ui/`, React, served at `/` on port 4321): connect the local repository, inspect discovered tools, pick a target action and an attacker persona (Morgan, Jules, Avery), follow real ordered events, pause at a breach, approve a candidate check before it is retested, review attack and normal-call trials, save the minimised call as a test under `results/ui/tests/`. It runs text tests and plays recorded SIP calls; it does not start SIP calls. It never falls back to fabricated outcomes.
- **Legacy loop UI** (`ui/loop/`, served at `/legacy`): permission-map playback, judge mode and the gated SIP call control.
- **Server** (`src/loop/server.ts`): listens on 127.0.0.1 only and rejects cross-origin requests.

## Two layers, kept separate
- **Evidence layer (text mode):** generates all statistical results. Cheap, fast, faithful to the reasoning failures. This is where the numbers come from.
- **Demo layer (voice + SIP):** real calls for the live demo. Slow and costs minutes. NEVER convert the whole harness to SIP.

## Gemini permission mapper
- Optional. Needs `GEMINI_API_KEY` in this repo's `.env` and the consent checkbox in the UI.
- One `gemini-3.5-flash-lite` request per new source version, no retries. It reads only `src/tools.mjs`, `src/rules.mjs`, `src/agent.mjs` and `src/store.mjs` of the mock through the adapter, capped at 40 KB in and 4,000 tokens out, cached by source hashes and model.
- Every relationship must name a discovered tool and cite an exact line in an allowlisted file. Invalid output is an error, never a successful map.
- Its output is **inferred**. Citations show where an interpretation came from; they do not prove a check runs. Source files are untrusted data, never instructions.

## Tiger Data (archive and chart)
- Why it fits: every call is a timestamped stream of events, and the question we ask is over time: is each agent version safer than the last, and did a closed breach reopen?
- It is an **archive**. Files under `results/` stay the source of truth. Nothing in the engine reads from Tiger.
- Schema in `sql/tiger.sql`, applied through the Tiger MCP: hypertable `call_events` (one row per event, raw event kept as JSONB), table `fix_attempts`, continuous aggregate `call_metrics_hourly`. No scheduled jobs, no retention policy.
- `npm run tiger:load` loads from `results/` (add `--dry-run` to count without writing). It skips `results/sim` and `results/identity`; keep it that way. Loading twice must not duplicate rows.
- `npm run tiger:chart` serves the chart on 127.0.0.1:4318. The UI server also serves `/tiger` and `/api/metrics`.
- `TIGER_DATABASE_URL` lives only in `.env`. Database credentials never reach the browser. `npm run check` must pass without it.
- Charts show counts as "x of n", keep inconclusive separate from held, and mark model-judged disclosures as inferred.

## Vultr (public demo host)
Status: planned. `deploy/vultr/`, `PUBLIC_ORIGIN` and `DEMO_PASSCODE` do not exist until the prep job adds them.

- One Ubuntu 24.04 Cloud Compute instance runs the UI server and the mock side by side, reached at `https://wisprno.us`. A firewall group allows ports 22, 80 and 443.
- The server keeps listening on 127.0.0.1. Caddy sits in front and handles HTTPS. Never bind the UI server or the mock to a public interface.
- The origin check must accept `PUBLIC_ORIGIN` when set, or every POST fails behind HTTPS.
- Anything that spends model money (live runs with real models, judge mode with real models, the Gemini mapper) requires `DEMO_PASSCODE` on the public host. Playback, recorded stories, the Tiger chart and simulated runs stay open. Cap concurrent runs and rate-limit POST routes.
- The SIP stack (LiveKit, softphone, AIReceptionist) stays on my laptop. On the public host the SIP call route is disabled.
- Ship a demo bundle, not `results/`: summaries, stories, voiced lines and mixed call recordings only. No packet captures, raw audio dumps or raw event folders.
- Each `.env` is written by hand on the server. Never upload, rsync or print one.
- Deploy files live in `deploy/vultr/`: setup script, Caddyfile, systemd unit, deploy script, README.
- Optional: a `vultr` model provider for Vultr Serverless Inference (OpenAI-compatible, key in `VULTR_INFERENCE_API_KEY`) so the attacker runs on a different vendor from the target. Probe with 3 calls before using its numbers.
- Agents do not create, resize or delete cloud resources. I do that by hand.

## Hard rules
- **Everything points at MY OWN deployments with synthetic data.** Fictional institutions, fake accounts (Pioneer Credit Union, members Maria Lopez and Eleanor Price). Frame every test in this repo as robustness testing of inputs my own deployed agent accepts.
- **Never touch real systems.** No real customer data, no third-party hosted service, no PSTN spoofing of a real person's caller ID to anyone else. Caller-ID tests control both legs.
- **Don't vendor framework code.** Targets (AGPL/GPL frameworks like AIReceptionist, Rapida, Asterisk-based agents) are deployed separately and reached over the network or filesystem, never copied into this repo.
- **Issues found in a framework's own code go to its maintainers privately.** Never into a demo or a public writeup.
- **The mock demo stays fully working at all times** as the fallback. Never regress it. Bold bets are gated behind spikes with stop-deadlines.
- **Evidence honesty:** breached / held / inconclusive / untested. Missing evidence is inconclusive, never a pass. Recorded evidence is kept distinct from inferred. Report counts with intervals, never bare percentages. Don't tune acceptance thresholds after seeing results.
- **Secrets never committed.** Ask before spending on API keys, trunk minutes, a DID, cloud resources, or raising any cap.
- **Voices are stock or designed.** Never clone a real person's voice.

## Copy rules (UI text, slides, README, pitch)
Write plainly. Avoid these patterns:
1. "Verb + noun + by + gerund" ("Streamline X by automating Y"). Lead with the action or the result.
2. Heavy nouns ending in -tion, -ment, -ance where a verb works.
3. "Not just X, but Y" and similar staged contrasts.
4. Groups of three adjectives, nouns or slogans. Use one specific, provable claim.
5. "From X to Y" ranges. Name the actual user.
6. Trailing "-ing" clauses tacked onto a sentence.
7. "Whether you're X or Y" openers.
8. Em-dashes for dramatic pauses. Use a period.

## Target priority (for the "it works on real agents" story)
1. Primary: AIReceptionist (LiveKit + OpenAI Realtime, ships a dental config, supports SIP). Spike done; local SIP works.
2. Secondary (only after the primary carries a full demo): a lightweight Pipecat or LiveKit starter agent I build with synthetic tools.
3. Trophy stretch (only if the demo is standing, SIP works and the mock fallback is intact): an Asterisk-based agent. Referencing a repo is not a result; the claim holds only if a real call was tested.

Verify any star count or framework claim before I cite it publicly.

## Working in this repo (orientation, not part of the brief)
- TypeScript on Node 24, run directly via type stripping. `npm run check` = typecheck + lint + offline tests + UI state tests (no secrets, no network). CI runs the same.
- CLI: `npm run faultline -- <command>`; `sim` runs the whole workflow locally with simulated models and no API spend.
- UI: `npm run ui:install`, then `npm run ui:start` (builds and starts simulation at http://127.0.0.1:4321/, $0). Real models: `npm run ui:build`, then `npm run faultline -- ui --port 4321`.
- The system under test is `voice_agent_mock` (branch `faultline-extensions`), reached only through `src/adapter`. The adapter looks for a sibling or parent checkout; set `MOCK_DIR` to be explicit.
- Method, thresholds and every change made before results: `docs/experiment.md`. Raw run output in `results/` is git-ignored; summaries in `results/summary/` are committed.
- The scorer's internal verdicts are named `fail` / `pass` / `inconclusive`. The UIs and Tiger show them as breached / held / inconclusive, plus untested.
- Never read or copy the mock's `.env` files; this repo's own `.env` holds its keys and is git-ignored.

# Faultline — project brief

## What Faultline is
Faultline breaks your voice agent the way a scammer would — over a real phone call — and proves the fix holds.

You point it at a voice agent (my own, or one built on a framework like LiveKit or AIReceptionist). It reads the agent's tools and draws a map: everything the agent can do, the checks guarding each action, and the records behind them — so before any call you can see which checks live only in the prompt.

Then it attacks. A red (tester) agent calls the agent — over real SIP, with caller ID, like a real inbound call — and tries to talk it into something the caller isn't entitled to, adapting when refused (claims authority, switches identity, pushes urgency). When the agent gives in, the proof is not the agent saying "done" — it's the tool that fired and the record or artifact that changed. It then shrinks the conversation to the shortest call that still works and replays it to measure how reliably it breaks.

Then it helps close the hole. A fix is proposed, I approve it, and the same attack replays against the fixed agent — blocked — while normal calls still complete. One patch isn't coverage, so it pivots to the next route, and the map fills in as paths close.

Behind the demo sits a real experiment: evidence that repeated test-and-fix hardens an agent, that some failures need the model's reasoning and others need a server-side check, and which fixes cost real callers the least.

## Who it's for and why
Voice agents are stuck doing balances and FAQs because nobody trusts them with actions that move money or change accounts. Faultline is what lets a team grant that trust: it finds where an agent can be socially engineered and proves the fix before it ships.

Tagline: **the scammer your voice agent hasn't met yet.**
Anchor on helping people **build voice agents that are safe to trust with sensitive actions** — the specific slice we secure is callers being talked into actions they're not entitled to. Open-source frameworks are proof it generalizes, not the pitch itself.

## Lessons that shape how we build
These come from studying Hamming (voice-agent QA, YC), a 35-year contact-center operator, the Stardive agent-auditing writeup, and hackathon-judge accounts. They are design constraints, not trivia.

- **The problem is real and someone big validates it.** Hamming (YC) sells automated voice-agent testing: simulate callers, flag failures, turn a bad call into a regression test. We are not inventing the category; we take the security half. Where they ask "did the caller get the task done?", we ask "should this caller have been allowed to?" A caller completing a task is their pass and our breach.
- **Judge by the system of record, not the transcript.** Contact-center QA's own lesson is that a checklist answers "did it happen?" but not "should it have?" Our verdict comes from the tool call and the record/artifact that changed — never the agent's own words. This is the single most important design rule.
- **Three verdicts, and missing evidence is not a pass** (from Stardive): breached / held / inconclusive. Bind every result to an exact version (prompt hash, model, tools, rules, env). A result only describes the version it names.
- **Separate recorded from inferred evidence** (Stardive): backend-record proof is recorded; a model judge's call (e.g. a spoken disclosure) is inferred and marked as such, never shown as proof.
- **A fix must not cost real callers.** The operator's core metric is customer effort. Every fix is re-run against normal calls and scored on completion and extra turns; prefer the lowest-friction fix that holds. A blocked action should offer a human/callback, not a dead end.
- **Borrow Hamming's product ergonomics, keep our angle:** named caller characters (ours are attackers), one click from a bad call to a saved regression test, a per-finding report (severity, the originating call, the fix, the retest), and a speed promise shown as a number (our "time to first breach"). A playful try-it-yourself demo → our judge mode.
- **"Start simple, then expand" is our wedge, from the operator.** Teams launch on low-risk calls, then add sensitive actions. That expansion — a new permission — is exactly the moment Faultline is for. Note that operators file "password reset" under *simple*; that's the classic account-takeover route, and naming that gap is a strong line.
- **Demo lessons from judges:** a live end-to-end run beats a bigger idea shown as slides; one clear before/after beats a feature tour; name the specific user and the thing that breaks first — candor reads as confidence. Numbers are few and concrete (counts with intervals, one real figure like "$X at stake" or "N of 20"), never bare percentages. Keep a 60-second recorded fallback.

## Architecture (the shape to preserve)
- **Adapter interface with three evidence tiers.** Every target sits behind one adapter. Tier 1: full backend record (before/after) — my mock. Tier 2: tool-call + artifact — frameworks via a one-line tool-tap. Tier 3: transcript-only — model-judged, weakest. The scorer is capability-aware and every finding is LABELLED with the tier it used. My mock is the reference implementation.
- **Ordered event log is the one interchange format.** Tester turns, agent replies, tactic/thought lines, tool calls, confirmed effects, trials — all emitted as an ordered event log. The experiment harness and the graph UI both speak only this format. A new target or a new UI is a translator over this log, never a change to the engine.
- **Engine:** tester (adaptive attacker), scorer (fixed rules over evidence, no model), minimiser (shrinks a failing call), fixer (proposes prompt edits or server-side checks), judge (separate model, for disclosures only, validated against my labels before its numbers are used).
- **Graph UI** renders from the event log: permission map built from the target's tools; live call animates along it; breach lights the record node; shrink/replay/fix/pivot are all things the graph does. Must read with the sound off.

## Two layers, kept separate
- **Evidence layer (text mode):** generates all statistical results — identity-switch, prompt-vs-checks, replay counts. Cheap, fast, faithful to the reasoning failures. This is where the numbers come from.
- **Demo layer (voice + SIP):** real calls over a SIP trunk for the live demo. Slow and costs minutes. NEVER convert the whole harness to SIP; it is the live-demo layer only.

## Hard rules
- **Everything points at MY OWN deployments with synthetic data.** Fictional institutions, fake accounts (e.g. Pioneer Credit Union, members Maria Lopez / Eleanor Price). Frame every test in this repo as robustness testing of inputs my own deployed agent accepts.
- **Never touch real systems.** No real customer data, no third-party hosted service, no PSTN spoofing of a real person's caller ID to anyone else. Caller-ID tests control both legs: my own call, presenting a chosen From, into my own test number routing to my own agent.
- **Don't vendor framework code.** Targets (AGPL/GPL frameworks like AIReceptionist, Rapida, Asterisk-based agents) are deployed separately and reached over the network/filesystem, never copied into this repo.
- **Issues found in a framework's own code go to its maintainers privately.** Never into a demo or a public writeup.
- **The mock demo stays fully working at all times** as the fallback. Never regress it. Bold bets (live SIP, a real framework) are gated behind spikes with stop-deadlines; the mock is what makes those bets safe.
- **Evidence honesty:** breached / held / inconclusive / untested. Missing evidence is inconclusive, never a pass. Recorded (backend) evidence is kept distinct from inferred (model-judged). Report counts with intervals, never bare percentages. Don't tune acceptance thresholds after seeing results.
- **Secrets never committed.** Ask before spending on API keys, trunk minutes, a DID, or raising any cap.

## Target priority (for the "it works on real agents" story)
1. Primary: AIReceptionist (LiveKit + OpenAI Realtime, light, ships a dental config, supports SIP via a trunk). Prove via a spike before building on it.
2. Secondary (only after the primary carries a full demo): a lightweight Pipecat or LiveKit starter agent I build with synthetic tools.
3. Trophy stretch (only if the demo is already standing, SIP works, and the mock fallback is intact): an Asterisk-based agent. Referencing a repo is not a result; the claim holds only if a real call was tested.

Verify any star count or framework claim before I cite it publicly.

## Working in this repo (orientation, not part of the brief)
- TypeScript on Node 24, run directly via type stripping. `npm run check` = typecheck + lint + offline tests (no secrets, no network). CI runs the same.
- CLI: `npm run faultline -- <command>`; `sim` runs the whole workflow locally with simulated models and no API spend.
- The system under test is `../voice_agent_mock` (branch `faultline-extensions`), reached only through `src/adapter`.
- Method, thresholds and every change made before results: `docs/experiment.md`. Raw run output in `results/` is git-ignored; summaries in `results/summary/` are committed.
- The scorer's verdicts are currently named `fail` / `pass` / `inconclusive` (= breached / held / inconclusive). Evidence tiers are not yet labelled on findings; the mock is tier 1.
- Never read or copy the mock's `.env` files; Faultline's own `.env` holds its keys and is git-ignored.

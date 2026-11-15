# WisprNo: flexible repository connection and complete investigations

Work in `/Users/justin/Desktop/Projects/hackumass/umass_agent_arena`.

Read `AGENTS.md` first. Implement, deploy and verify the work. Do not stop at a plan. Never estimate implementation durations. Inspect the current working tree and preserve unrelated changes. Existing integrations and the Pioneer simulation fallback must keep working.

## User outcome and completion standard

After this session, I expect to open `https://wisprno.us`, connect a new owned synthetic voice-agent repository that WisprNo has never seen, and drive the entire supported investigation from the UI:

**Landing → New analysis → Connect repository and running target → Validate → Map → Target persona → Attacker and objective → Review cost and approve launch → Attack → Evidence analysis → Shrink → Baseline replay → Propose fix → Explicit fix approval → Apply isolated candidate → Attack replay and legitimate-call checks → Findings, calculations and report → Saved playback and Tiger sync.**

Connecting a repository must not create an empty run or make paid model calls. Clicking launch after explicit spend confirmation starts real calls when real mode is selected. Never silently substitute simulation.

This must work for new repositories through generic discovery and adapter behavior, not pre-registered names, known folder paths, copied sample prompts or hard-coded attacks. A new agent may differ substantially from Pioneer, pharmacy, utility and clinic. Do not require their exact source layout, framework, tool names, field names or verification mechanism.

Do not promise error-free support for every arbitrary repository. Define and implement a useful compatibility boundary, handle external failures honestly, and demonstrate generalization with unseen structures. A supported target must complete the workflow without implementation errors or manual registry edits. An unsupported target must receive a precise connection-time explanation and a path to compatibility, never a fabricated map, false pass or mid-run surprise that preflight could have caught.

## Blind specimen boundary

`target-bank` is my held-out test specimen. Do not inspect, search, import, execute, register, modify or read files from it while designing or implementing this work. Do not use a report about its weaknesses to tailor attacks, scoring or fixes. Exclude it from recursive discovery commands.

Build against the existing non-held-out samples and independently constructed synthetic fixtures with different layouts and semantics. Freeze and record the generic implementation revision and scoring policy before the blind evaluation. Ask for the specimen connection only when the platform is ready; I may connect it myself through the UI.

Connection metadata is allowed at evaluation time: endpoint, credentials, source fingerprint and declared capabilities. It is not permission to write target-specific code or precompute expected findings. Discover tools and behavior through the same user-facing workflow available to other new targets.

## Current baseline to inspect, not assume

- React UI: `faultline-ui/`; server: `src/loop/server.ts`.
- Current routes: `/` landing, `/new` setup, `/analyses` library, `/analysis/run/:id` and `/analysis/story/:id` playback. Preserve legacy `/#history` and `/index.html` behavior.
- Shared sticky header, plum/lilac/lime palette, WisprNo logo and attacker avatars already exist. Preserve their usability at 1440×900, 1280×800, 1280×720 and 390×844, plus increased zoom and keyboard navigation.
- Generic HTTP transport: `src/adapter/http.ts`; registry/upload handling: `src/adapter/repositories.ts`; source recognition: `src/adapter/voice-repository.ts`.
- Contract scoring: `src/scorer/contract.ts`; one-attempt generic integration: `src/loop/contract-live.ts`; fuller Pioneer workflow: `src/loop/live.ts`.
- Generic targets currently lack the complete minimization/fix/retest workflow. Prompt override capability alone does not mean that workflow is implemented.
- Registry entries and source stamps currently require operator setup. Uploaded source must match a registered target before testing. Remove this manual onboarding dependency.
- Current scorer recognizes specific identity/code check-name patterns. Unknown semantics must not become a pass. Replace this dependency with validated, explicit authorization semantics.
- Existing readiness does check authentication, source identity, providers, budgets and catalogue consistency; it does not run the complete external contract kit.
- Existing uploads filter source and enforce 80-file/200 KB limits. Do not blindly increase upload limits or transmit entire dependency trees.
- Main environment keys are in this repo's ignored `.env`. Never read or copy any sibling target's `.env`.
- Related specifications and contract fixtures may be in `../CONTRACT.md`, `../TARGETS.md`, `../contract-kit/` and the non-held-out sample repositories. Read selectively and avoid specimen-specific information.
- Current public preview allows browsing but protects mutations and raw evidence with operator authentication. Keep paid actions protected and make the operator sign-in flow usable from the UI.
- Recurring real-run access was authorized: `src/loop/run-allowance.ts` supports `results/live-approved-recurring`, with the master spend switch still enforced. Preserve that authorization and the existing caps; do not reintroduce a per-run operator file-edit requirement.
- Replay audio currently falls back to browser speech when recorded audio is absent. Never describe this as an actual recorded voice call. Audio improvements are secondary to completing this task and require explicit paid-TTS approval if generation is needed.

## 1. Flexible source discovery and mapping

Implement framework-aware and framework-independent discovery into one normalized capability model. The public map must not be a fixed Pioneer graph with renamed labels.

Support differing directory structures, Python and JavaScript/TypeScript source, tool decorators/registrations, provider wrappers, prompts, authorization logic, storage access and handoff mechanisms. Use both source evidence and runtime declarations where available. Preserve file paths, line citations, source hashes and extraction provenance.

An optional `wisprno.target.json` manifest may describe a target, but it must not be the sole recognition path. Also support a guided connection using a runtime contract and source selection. A manifest may supply hints about source roots, endpoint, adapter, capabilities and environment variable names. It must never contain secrets or authorize code execution. Treat manifest fields, repository text and model output as untrusted data.

For a large selected folder:

- Inspect filenames/metadata locally in the browser before reading and transmitting contents where feasible.
- Exclude dependencies, generated assets, environments, credentials, databases and unrelated data.
- Select a bounded, relevant source set through entry points, framework configuration and import relationships instead of rejecting every unfamiliar repository merely because it has thousands of files.
- Let the user review or narrow the selected source when bounds are reached. Report omitted coverage honestly.
- Never claim a complete map when only part of the source was inspected.

The map must represent actual discovered tools, resources and guards. Clearly separate:

- **Declared:** target or manifest says a capability/check exists.
- **Source-observed:** code and citations show a possible implementation path.
- **Inferred:** a model or static heuristic interprets relationships.
- **Runtime-observed:** an executed path and evidence show what happened.

Unknown relationships remain unknown. Do not invent edges to make a polished graph. Tailored relationships are allowed only when labelled and must not be represented as universal discovery. Mapping animation must follow actual work or be explicitly presentation, never an artificial timer pretending to inspect code.

Optional Gemini-assisted mapping must work over the selected repository's bounded source, not four hard-coded mock files. Validate citations and tool identities, cache by exact source/model/policy version, and require explicit consent before spend. Local inspection must remain available without paid mapping.

## 2. UI-only onboarding of a running owned target

Implement an authenticated **Connect target** flow. The user should be able to choose source, supply or confirm the endpoint, provide credentials privately, see connection checks, and save the connection without editing registry JSON, environment files or stamp files by hand.

Store credentials securely server-side, with restricted permissions, redaction and no browser persistence or response echo. A token entered in a form passes through browser memory; do not claim otherwise. Never put credentials in manifests, URLs, localStorage, screenshots, logs or committed files. Preserve CSRF/origin protections and isolate connection records appropriately.

Validate URLs and network access against an explicit owned-target policy. Do not add unrestricted arbitrary-URL fetching, cloud metadata access or source-driven outbound requests. Preserve localhost-only access by default.

Important hosting boundary: on `wisprno.us`, `127.0.0.1` means Vultr, not the user's laptop. A folder upload does not make a laptop process reachable. For this task, targets may be started manually as separate services on the existing server, or run alongside a local WisprNo instance. Make this prerequisite clear in the UI before connection. Do not imply that a local companion, tunnel or remote installer exists. Do not build arbitrary repo execution or dependency installation into the website.

A displayed start command is guidance only. Never execute a manifest's commands automatically. Keep target code separate from WisprNo.

Persist connection metadata, source identity, credentials reference and compatibility results. Generate source stamps automatically from a validated connection; never manufacture a match. Source/runtime changes invalidate the relevant checks and require revalidation.

## 3. Compatibility negotiation and preflight

Implement a versioned adapter contract and explicit capability negotiation. Normalize varying source layouts and tool metadata without changing the investigation engine for each target.

Different agent frameworks need a compatible runtime adapter or instrumentation boundary. Provide a documented small tool-tap/bridge path where a repository lacks the native HTTP contract. Make the extension points reusable and demonstrate them with structurally different synthetic fixtures. Do not treat source recognition as proof of runtime testability.

Preflight must validate endpoint reachability, authentication, catalogue/version consistency, session isolation, evidence shape, tool argument schemas, authorization metadata, record/artifact correlation, supported candidate overrides, normal-call fixtures and provider/spend readiness.

Integrate reusable contract checks. Separate read-only probes from checks that create sessions or mutate synthetic state. Run mutating checks only in an explicitly isolated disposable fixture/stub mode that the target supports; never silently switch an existing deployment to stub mode. Stub compatibility is not proof that real model access works. Do not start paid calls during connection without separate approval.

Show pass/fail/unsupported results and actionable corrections in the UI. Some target capabilities may be absent: offer the corresponding honest evidence tier and explicitly limit what can be scored. Missing prerequisites for the requested full workflow must be identified before launch.

## 4. General authorization semantics and evidence scoring

Remove dependence on check-name prefixes such as `identity:<tool>` or `code:<tool>`. A versioned `requires` field can support none/KBA/OTP as a compatibility baseline, but do not assume every voice agent uses that hierarchy.

Define normalized authorization requirements that can express subject ownership, authentication/verification level, roles or scopes, transaction consent and per-tool requirements. Represent when and where authorization is established, including guards inside the tool. Unknown requirements are unsupported/inconclusive, not automatically satisfied.

Keep the evaluator's intended security policy separate from the target's declared behavior. Let the operator confirm a policy before the investigation and freeze its version. A vulnerable target declaring no checks must not define away the vulnerability. Do not adjust thresholds or policy after observing results.

Use resolved subjects, authorization context, tool arguments, tool results, before/after records or artifacts, handoffs and ordered events. Correlate them and bind every finding to exact source, prompt, model, tools, rules, adapter and policy versions. A model saying an action succeeded is not backend proof.

Keep breached, held, inconclusive and untested separate. Confirmed evidence may establish a breach even if a later provider call fails; incomplete coverage must remain visible. Support read/disclosure findings as well as mutations and handoffs.

Use a model judge only for questions that deterministic backend evidence cannot resolve, such as spoken disclosure. Label those results inferred and keep them distinct from backend-record findings. Validate a changed judge against labelled fixtures before relying on it.

## 5. Complete generic investigation lifecycle

Reuse/refactor the existing engine rather than building a second disconnected demonstration. Every stage must consume and emit the ordered event log.

Implement for supported newly connected targets:

1. Dynamic objectives and attacker briefs from the discovered tools, frozen policy and synthetic seed data. Do not send OTPs, admin tokens, legitimate handset secrets or hidden verification answers to the attacker.
2. Adaptive model-driven attacks with bounded attempts, caller turns, model/tool requests, output tokens and retries. Show actual responses and progress.
3. Deterministic evidence scoring and findings correlated to source/version and backend evidence.
4. Minimization of a reproducible breach, preserving the exact tested version and objective. Failed reduction attempts are evidence, not an excuse to fabricate a shorter attack.
5. Repeated baseline replay of the retained attack, with counts and uncertainty.
6. Candidate fix proposals that use only adapter-supported changes. Show the exact prompt patch or supported check change and explain its intended effect.
7. Explicit user approval before any candidate is applied or tested. Reject/skip must work. Do not alter the deployed default or write target files merely because a proposal exists.
8. An isolated candidate version, attack replay against it, and legitimate-call checks on both baseline and candidate. Measure completion, additional turns and caller effort; include safe refusal/handoff behavior.
9. Versioned acceptance or rejection with reasons. If the fix fails, preserve its evidence and continue only within approved bounds. If the target supports no safe candidate mechanism, identify that limitation before the run; do not claim a completed fix verification.
10. A final report and saved playback accessible through the library and stable deep links.

A held or inconclusive attack may end without a fix. Explain which later stages were unnecessary or not executed. Never force a breach to demonstrate the workflow.

Normal-call scenarios must have explicit expected tasks/outcomes and their own authorized caller context. Derive or import them from the connection contract and obtain confirmation when inferred. Model-generated normal calls are not automatically valid success criteria.

## 6. Report, calculations and persistence

Display an evidence-backed report containing:

- Target, source/runtime/policy versions, adapter, execution mode and evidence tier.
- Objectives tested and untested coverage, with omitted-source and unsupported-capability limits.
- Breached/held/inconclusive counts with denominators; declared interval method where applicable.
- Baseline and candidate replay results tied to the same retained attack, with candidate approval history.
- Normal-call completion and effort on both versions.
- Original versus minimized caller turns and the tested reproduction counts.
- Actual elapsed stage/run times measured from events, not predicted implementation or investigation durations.
- Model/provider requests, retries, reported token usage, estimated provider charges and reserved budget as distinct quantities. Unknown cost remains unknown; reservations are not invoices.
- Findings linked to actual transcript, tool and record/artifact evidence.

Persist archives and connection metadata across restarts. Preserve saved evidence unchanged; presentation enrichment must not rewrite raw events. Preserve current Tiger ingestion's durable queue, retry support and idempotency. Keep simulations, UI investigations and formal experiments separate. Demonstrate exactly-once storage of the completed investigation, including retry after a database outage.

## 7. Spend controls and Gemini judging

Existing approved cumulative deployment caps are OpenAI $5, Gemini $2, Anthropic $3 and ElevenLabs $0, with no reset. Request limits also exist, including Pioneer target 100 and harness 40, and separate limits for contract targets. Inspect actual remaining allowances. Do not reset or raise them without explicit approval.

Recurring access means the operator may launch repeated runs through the UI within those caps. It does not authorize this implementation session to autonomously start unspecified paid tests, mapping or narration.

Add a per-investigation budget and explicit stage/request/token bounds, with atomic reservations covering attacker, target, fixer, caller, judge, mapper where applicable and every retry/tool-loop model call. Propose $1 as the initial per-investigation ceiling; request approval before activating this new setting. Preserve stricter existing limits. Stop or pause honestly on exhaustion with evidence intact; do not promise that every full workflow fits the ceiling.

Check current official pricing rather than copying stale rates. Unknown models/pricing must fail closed or require an explicit configured pricing policy. Do not claim dollar enforcement over a target/provider path that WisprNo cannot meter or constrain.

Support Gemini as an optional disclosure judge. Verify the chosen model and project tier; do not assume a configured key is free. Free-tier limits are project-scoped RPM/TPM/RPD and may be shared with other jobs. Implement a durable queue, bounded concurrency/retries, rate-limit backoff, source/transcript/model/policy keyed caching, and pause/resume on quota exhaustion. Do not silently switch to a paid model or count an unavailable judge as a held result. Keep deterministic backend scoring independent of judge availability.

Before real verification, present a concrete bounded test specifying targets, stages, models, maximum requests/tokens/retries and applicable budget enforcement. Request only missing approval. Do not start SIP, PSTN, ElevenLabs or paid narration as part of this task.

## 8. Deployment and operational constraints

Deployment to the existing Vultr instance is authorized:

- Domain: `wisprno.us`
- Host: `66.42.95.122`; SSH user `root`
- Local key: `/Users/justin/.ssh/id_ecdsa`
- Expected previously accepted ED25519 fingerprint: `SHA256:g16q2RGvdKZAIw7Dl9Vg/LNeDyROm/lCuXA1B05o3nE`

Test noninteractive authentication. Never disable host-key checking, discard mismatches, request a private key/password in chat or upload the Mac private key. Inspect services/ports/files before modifying anything. Preserve unrelated workloads. No new or resized cloud resources, purchases or spending-cap increases.

Inspect `deploy/vultr/README.md` and current services. Existing paths include `/opt/wisprno/current`, `/opt/wisprno-target/current`, `/opt/wisprno-targets/`, `/var/lib/wisprno/results` and `/etc/wisprno/`. Deploy actual intended working-tree code, not assumed remote HEAD. Back up configurations and keep a rollback path. Check active runs before restarting. Do not interrupt an investigation or pending fix approval.

UI and targets remain loopback-only behind the existing HTTPS proxy. Keep target/admin APIs private. Preserve SSE behavior, origin checking, authentication, CSRF defenses and persistent service users/state. Authorized keys may be transferred from WisprNo's own environment through an allowlisted secure mechanism without displaying values; never blindly upload environment files.

## 9. Verification required before claiming completion

Run appropriate offline checks and browser checks. Exercise real handlers, not mocked success animations.

Demonstrate:

- Fresh UI connection without manual registry, token-env or stamp-file edits.
- Structurally different Python and JS/TS fixtures, renamed tools/fields, unfamiliar verification names and at least one optional-manifest-free connection path.
- Non-voice repository rejection, bounded large-folder selection, secret/path/manifest validation and partial-source coverage reporting.
- Runtime/source mismatch, malformed contract, invalid credentials, unsupported authorization semantics and missing adapter capabilities.
- Full UI workflow on a supported target, including actual attack evidence, minimization/replay when a breach exists, candidate approval, isolated retesting, normal-call results and report calculations.
- Scripted fixture breaches for offline pipeline coverage, clearly labelled simulation. A genuine real-model run may hold; do not manipulate it to obtain a breach.
- Budget exhaustion, shared-provider limits, retries, Gemini quota pauses, provider errors and interrupted SSE, with no false held verdict or duplicate paid launch.
- Browser Back/Forward, reload/resume, active-run protection, direct routes, archived playback, focus visibility and all specified viewport sizes.
- Authentication and protected actions; no anonymous paid launch or admin access.
- Run and credential persistence across service restart, immutable raw evidence and Tiger outage/retry/duplicate prevention.
- No specimen-specific changes and no reads of `target-bank` during implementation.

Freeze the implementation and record checks before the held-out test. Do not claim unseen-repository generalization from samples alone. If blind evaluation needs my connection or spend approval, finish all independent work, leave a concrete ready-to-test flow, and state that exact remaining acceptance item.

## Final delivery

Provide a concise factual report with:

1. Working HTTPS URL and exact UI steps to connect a new repository and running target, authenticate, launch, review a fix and view the report.
2. Supported discovery/adapter capabilities and explicit limitations, including the laptop-versus-server networking boundary.
3. What was implemented and deployed, tests run, and screenshots of connection, dynamic mapping, arena and report.
4. Whether a real-model end-to-end investigation was executed, its observed outcome, stage coverage, actual/estimated usage and remaining budget. Distinguish fixture coverage from real evidence.
5. Whether the blind specimen remained untouched and the frozen revision ready for its evaluation.
6. Tiger ingestion result, persistent paths, operating commands and rollback instructions.

Do not call the task complete merely because connection or mapping works. The deliverable is a usable, honest end-to-end investigation platform for new compatible targets with flexible source structures.

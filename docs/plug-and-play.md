# Plug-and-play investigations

Wisprno translates a supported target's existing HTTP API. A `wisprno.bridge.v1` endpoint and manifest are optional. Uploads are source data; the shared web host never executes them. Arbitrary voice frameworks without a supported evidence API are not yet compatible. Framework recognition alone never enables launch.

## Existing session API boundary

The existing adapter supports `/tools`, `/version`, `/readiness`, `/budget`, `/admin/fixture`, and the `/sessions`, `/sessions/:id/start`, `/messages`, `/evidence`, `/handset` API. The schemas are the same bounded tool/session/evidence shapes used by the HTTP adapter. In particular:

- `/tools` includes object argument schemas, opaque tool names, kinds and resource names. Check names do not define the evaluator policy.
- `/readiness.sourceHashes` binds each selected source file by relative path and SHA-256. Selection may be partial; omitted files remain uninspected. A matching folder name or framework import does not prove this binding.
- The prompt is a bounded literal in selected JS/TS or Python source whose SHA-256 equals `/version.promptHash`. Source is never evaluated or imported to recover it. Dynamic prompts need another adapter.
- `/admin/fixture.calls` supplies normal examples: name, kind `normal`, session ANI/handset, literal caller lines, expected tool and subject under `expect.change`, authorization level under `expect.auth.level`, and an exact record assertion under `expect.record: {path, value}`. Missing examples or ambiguous semantics block full investigation. Expectations are reviewed in the UI and never learned from an attack's outcome.
- Authentication may be absent, including session tokens. Wisprno sends no Authorization header when no credential is needed. Session isolation is verified through distinct session IDs and unchanged records in the other session.
- Sessions must isolate records and prompt overrides. Evidence carries ordered tool results, unique request IDs, resolved subjects, auth before/after with explicit member identity (or null), correlated record snapshots and complete version stamps. Missing or inconsistent evidence is inconclusive.

These are capabilities of supported APIs, not instructions to add a new endpoint or modify a repository. If a target lacks them, Wisprno explains which adapter capability is unsupported before launching. The independent Python and JS fixtures exercise this boundary; they do not establish universal framework compatibility.

## Local startup

Download the companion from the Connect screen. From the owned synthetic repository, use `node ~/Downloads/wisprno-companion.mjs --start`. For a Python script, add `--entry path/to/agent.py`.

The npm start script or Python entry must already have its dependencies installed and honor `PORT`, `ADMIN_TOKEN` or `TARGET_ADMIN_TOKEN`, and `DB_PATH` when persistent storage is used. The companion chooses a free port, supplies a temporary access key and a private temporary database path, and owns only the processes it starts. It does not read environment files, edit source/configuration, install packages, stop an existing agent or guess its credentials. Projects with other startup settings require another adapter. An existing process may still be connected by address, with its legitimate key if required.

Pairing is private to the browser and persists across server restarts. Managed CLI restarts reuse the pairing for that repository and mode. A new browser, expired pairing or changed source needs revalidation. In-flight calls are never automatically replayed after a transport failure.

## Metered real-model startup

The optional `--real` profile starts two local processes: a scripted process for unpaid compatibility checks and a real process behind Wisprno's local model gateway. In addition to the settings above, this profile requires support for `MODEL_PROVIDER=stub/openai`, `OPENAI_MODEL`, `OPENAI_BASE_URL` and `OPENAI_API_KEY`.

Only non-streaming OpenAI-compatible `gpt-4.1-mini` chat is supported. The companion supplies a temporary gateway credential, not a provider key. The gateway has no usable grant during startup or connection. An explicitly approved investigation supplies a grant only while its target turn is dispatched. Each turn permits at most eight requests; each request permits at most 32,000 input bytes and 1,000 output tokens. Gateway requests are not retried. Duplicate IDs, stop requests, provider failures and unavailable spend controls fail closed.

Each actual request reserves against the investigation's $1 / 100-request ceiling and the persistent provider ledger. Harness retries also reserve before dispatch and remain subject to the existing cumulative harness cap. Provider caps are unchanged: OpenAI $5, Gemini $2, Anthropic $3, ElevenLabs $0. Failed requests are not refunded. The local profile does not require a separate execution host. The separate managed-host feature remains unavailable on the public host.

## Investigation and frozen evaluator

The user confirms a per-tool policy before tests. Ownership, authorization levels, roles, scopes, consent and the point at which authority is established are explicit. A target's empty check list cannot remove the policy. Unknown semantics are inconclusive. The optional Gemini disclosure judge remains disabled unless its original validation threshold passes.

After compatibility checks, the UI maps tools, selects an objective and persona, and requests spend approval for a real-model run. A confirmed breach proceeds through reduction and three baseline replays. The exact appended prompt proposal requires separate approval. Three candidate replays and the selected tool's normal calls run on both baseline and candidate versions. A failed reduction, rejected candidate, decline or stop remains recorded evidence. Held or inconclusive attacks may skip fix stages. No deployed prompt or repository file is patched.

The ordered event log, source/runtime/prompt/model/adapter/policy stamps, report, saved regression and immutable ingestion bundle preserve the evidence. Tiger retries do not change verdicts or duplicate a stored investigation. Fixtures and mocked providers are simulation evidence, never real-model performance claims.

## Independent verification

- `npm run check`: required offline regression suite.
- `tests/existing-workflow.test.ts`: unchanged actual Python and JS processes, temporary protected startup, no-auth API, full workflow and production-mode handlers.
- `tests/gateway-investigation.test.ts`: whole real-mode transport path with a simulated upstream provider and actual reservation ledgers. No paid request.
- `tests/model-gateway.test.ts`: startup denial, scoped grants, duplicate requests, failures, limits and separate scripted routing.
- `node scripts/verify-existing-browser.ts`: real local browser, outbound companion, upload, policy, full workflow, approval/reload, saved regression, decline/abort, pairing recovery and viewport screenshots.

`artifacts/plug-and-play/` holds verification logs and screenshots. An implementation/scoring hash manifest is recorded after independent checks and before any held-out evaluation. `target-bank` is excluded and remains untouched. No assertion about the agent previously running on port 4414 follows from these fixture tests.

# WisprNo

Site: [wisprno.us](https://wisprno.us).

Brand: the [WisprNo brand kit](WisprNo-Brand-Kit/README.md) supplies the vector logos and plum, lilac, and lime palette. UI assets live in `ui/brand/`.

WisprNo is a test harness for voice agents. It plays simulated callers against an agent, reads the agent's backend
record of what actually happened (tool calls, verdicts, account state before and after), and decides from that
record, not from what the agent says, whether the agent broke its own rules. When it finds a failure it shrinks it to
the shortest call that still fails, asks a fixer agent for a fix, and checks that the fix holds without hurting
normal calls.

The first system under test is [`voice_agent_mock`](../voice_agent_mock), a synthetic credit-union phone agent with
made-up members. All data is synthetic and everything runs on 127.0.0.1.

## Layout

| Folder | What it does |
| --- | --- |
| `src/adapter` | The only code that talks to the system under test (create session, start, send turn, evidence, handset). |
| `src/tester` | Simulated adversarial caller (the tester agent) and the cooperative caller for normal calls. |
| `src/fixer` | Fixer agent: prompt-only edits or checks-only rule selection. |
| `src/scorer` | Fixed rules over evidence. No model. |
| `src/judge` | Disclosure judge (a separate model). Its results are labelled *inferred*. |
| `src/minimiser` | Shrinks a failing call to the shortest frozen script that still fails in at least 5 of 10 replays. |
| `src/runner` | Experiment loop, normal-call suite, final exam, event log and reports. |
| `src/providers` | Model provider interface (OpenAI, Anthropic, Gemini) selected by config. |
| `tests` | Offline tests: hand-made evidence, test doubles, no network, no secrets. |
| `results` | Run output. Raw logs are git-ignored; `results/summary` is committed. |
| `ui` | Reserved for a replay UI (reads the event logs). |

## Setup

Requires Node 24 or newer. TypeScript runs directly through Node's type stripping; `tsc` is used only to type-check.

```sh
npm ci
npm run check          # typecheck + lint + tests (offline)
cp .env.example .env   # then fill in keys and the mock's admin token yourself
```

## Point it at the mock

1. In `voice_agent_mock`, use the `faultline-extensions` branch (custom prompts, per-tool rules, reply check, handset
   read and version stamp). Configure its own `.env` (`ADMIN_TOKEN`, `ENABLE_PROVIDER=true`, `OPENAI_API_KEY`,
   `CHAT_MODEL`, and a `MAX_PROVIDER_REQUESTS` large enough for the run), then `npm start`.
2. In this repo's `.env`, set `TARGET_URL` (default `http://127.0.0.1:4310`) and `TARGET_ADMIN_TOKEN` to the mock's
   admin token. WisprNo never reads the mock's `.env`.
3. Check the connection: `npm run faultline -- health`.

## Dry run (no API spend)

```sh
npm run faultline -- sim                # full workflow locally
npm run faultline -- sim --rounds 1 --exam-n 5   # smoke run
```

Starts the real mock server in-process on 127.0.0.1 (temporary database, `MOCK_DIR` defaults to
`../voice_agent_mock`) and swaps every model for a local simulation (`src/sim`): a target agent with hand-written weak
spots, a scripted tester and caller, a phrase-matching judge and a table-driven fixer. Everything else (adapter,
scorer, minimiser, loop, exam, report, event logs) is the real code. Output goes to `results/sim/` (git-ignored); the
numbers say nothing about any real model.

## Run the experiment

```sh
npm run faultline -- judge-validate          # judge agreement on 20 hand-labelled transcripts
npm run faultline -- normal --version v0     # normal-call suite on the baseline agent
npm run faultline -- probe --case payout_change --n 3
npm run faultline -- round --strategy prompt --round 1
npm run faultline -- loop --strategy prompt  # full loop: up to 8 rounds or the request cap
npm run faultline -- exam --strategy prompt
npm run faultline -- report
```

See [docs/experiment.md](docs/experiment.md) for the question, method, thresholds (fixed before any results) and
assumptions.

## UI (local target and recorded calls)

```bash
npm run ui:install                     # install the supplied frontend dependencies
npm run ui:start                       # build + start simulation at http://127.0.0.1:4321/ ($0)
npm run ui:live                        # real-model mode at http://127.0.0.1:4323/; requires the separate target
```

Connect the local repository, inspect discovered tools, configure the target and caller, and run an attack. The UI
streams real backend evidence, pauses at breaches, asks for approval before testing a candidate check, and displays
measured replay and normal-call results. Save minimized regressions under `results/ui/tests/`.

The adapter locates `voice_agent_mock` in a sibling or parent directory; set `MOCK_DIR` to override. It never reads
that checkout's environment files. For a running target using real models, build with `npm run ui:build`, then run
`npm run faultline -- ui --port 4321`. The frontend requires model-spend authorization before starting a run.

**Recorded calls** opens existing text and SIP evidence. The new UI does not initiate SIP calls. The legacy loop
remains available at `/legacy` after `npm run ui:loop`, including its existing gated SIP controls.
See [faultline-ui/README.md](faultline-ui/README.md) for the connected workflow and evidence boundaries.

## Safety

- Synthetic data only. The mock binds to 127.0.0.1 and rejects browser origins; WisprNo calls it from this backend
  process.
- Secrets live only in `.env` (git-ignored). Tests and CI run without secrets or network access.
- Every provider error marks the session inconclusive; WisprNo never silently retries a paid turn.

### Observing a new real-model outcome

`ui:start` and `ui:sim` use scripted models. `ui:live` starts the UI without `--sim`; starting this server alone does not call a model. Start your separately deployed `voice_agent_mock` with its provider enabled, then check `npm run faultline -- health`. Configure the target in its own environment; this repository never reads that environment file. The synthetic accounts and real tool/backend evidence should remain in place for real-model tests.

Open port 4323, connect the local repository, choose a permission and attacker, and review the model-spend authorization before launching. The full UI investigation can include multiple attacks, minimization, replays, fixes, and normal calls; it is not one API request. The target-request cap is not a dollar cap or a total cap on all harness model calls. A blocked or inconclusive attempt is a valid observed outcome; a breach must have correlated backend evidence.

Historical Tiger results and recorded playback are distinct from a newly executed test. New UI investigations currently remain in local run archives and are not automatically ingested into Tiger's experiment comparison.

### Managed-startup preview (worker not enabled)

The new **Let Wisprno start it** path launches reviewed source on a separate execution worker. Local Python and Node container fixtures complete the existing scripted investigation workflow. Public mode requires a dedicated rootless runsc worker; public isolation and hosted real-model access remain unverified/unimplemented respectively. See [managed execution](docs/managed-execution.md) for the exact boundary and activation prerequisites. The application and companion are deployed at https://wisprno.us; no new Vultr resources were created. Managed execution remains disabled until a separate worker is available. The companion and direct connection paths remain available.

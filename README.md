# Faultline

Faultline is a test harness for voice agents. It plays simulated callers against an agent, reads the agent's backend
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
   admin token. Faultline never reads the mock's `.env`.
3. Check the connection: `npm run faultline -- health`.

## Dry run (no API spend)

```sh
npm run faultline -- sim                # full workflow locally, ~7 minutes
npm run faultline -- sim --rounds 1 --exam-n 5   # quick smoke run, ~15 seconds
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

## Loop UI (playback and live)

`Faultline_Loop.html` replays recorded runs as the attack → shrink → replay → fix loop on the permission map. It is
built from saved results only (`src/loop/from-experiment.ts`, `src/loop/from-sip.ts`): the checks-strategy round whose
server-side fix was accepted, and every live SIP call with its mixed call recording.

```bash
node scripts/build-loop-stories.ts      # results → ui/loop/stories.json (git-ignored)
npm run ui:loop                         # → Faultline_Loop.html (open directly: playback only)
npm run faultline -- ui --sim           # http://127.0.0.1:4320/ : playback + live loop + judge mode, simulated ($0)
npm run faultline -- ui                 # same against the running mock (TARGET_URL); live loops spend model calls
```

Served mode adds **Run loop** (a demo-sized live loop on the mock: up to 4 attempts, 10 replays, 6 normal calls,
2 fix proposals; streamed as it runs), **Place SIP call** (the gated `sip-call --mode live`; needs the AIReceptionist
worker running and a remaining authorization) and **Judge mode** (your turns go to a real session on the mock; every
reply, tool call and record shown comes from its evidence). The server listens on 127.0.0.1 only.

## Safety

- Synthetic data only. The mock binds to 127.0.0.1 and rejects browser origins; Faultline calls it from this backend
  process.
- Secrets live only in `.env` (git-ignored). Tests and CI run without secrets or network access.
- Every provider error marks the session inconclusive; Faultline never silently retries a paid turn.

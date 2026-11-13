// `npm run faultline -- sip-call --mode echo|live`: one adaptive tester call over real local SIP (demo layer).
//
//   echo  $0 transport check. Frozen lines spoken with macOS `say`, no transcription, against the model-free echo
//         agent (spike/aireceptionist/echo_agent.py). Never produces a verdict about the target.
//   live  The tester agent, OpenAI speech in and out, against our AIReceptionist deployment. Refuses to dial unless
//         the deployment's SIP authorization has a call left and the budget ledger can hold this call's reservations.
//
// Statistical experiments never use this path; they stay in text mode against the mock.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { modelFromSpec } from '../providers/index.ts';
import { loadConfig } from '../runner/context.ts';
import { writeJson } from '../runner/util.ts';
import { TesterAgent, type CallerMove, type Speaker } from '../tester/agents.ts';
import { BaresipPhone } from './baresip.ts';
import { runSipCall } from './call.ts';
import { SIP_SCENARIOS } from './scenario.ts';
import { callerTurnAt, findTargetRun, mergeLogs, readEvents, scoreSipCall, type TargetEvent } from './target.ts';
import { LocalVoice, OpenAIVoice, type Voice } from './voice.ts';

const DEPLOY = resolve(process.env.FAULTLINE_DEPLOY_DIR ?? join(homedir(), '.local/share/faultline/deployments'));
const RUNTIME = join(DEPLOY, 'AIReceptionist', 'faultline-runtime');
const PHONE_DIR = join(DEPLOY, 'direct-sip', 'phone-adaptive');
const DIAL = process.env.SIP_DIAL_URI ?? 'sip:+12025550100@127.0.0.1:5060';
const TARGET_RESERVE_USD = 2; // what the deployment reserves per SIP call (its own guard)
const CALLER_RESERVE_USD = 0.5; // tester model + TTS + STT for one call; a deliberately loose upper bound

const ECHO_MOVES: CallerMove[] = [
  { plan: 'echo check: first line', say: 'Hello, this is a transport check. Can you hear me?', endCall: false },
  { plan: 'echo check: second line, then keypad 5', say: 'Testing a second turn. Now I will press the five key.', keys: '5', endCall: false },
];

/** Fixed moves, including keypad presses, for the $0 echo check. */
class EchoScript implements Speaker {
  readonly model = 'frozen';
  private i = 0;
  async next(): Promise<CallerMove> {
    return ECHO_MOVES[this.i++] ?? { plan: 'script finished', say: '', endCall: true };
  }
}

function running(pattern: string): boolean {
  try {
    execFileSync('pgrep', ['-f', pattern], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface Ledger {
  approvedUsd: number;
  runs: { runId: string; reservedUsd: number }[];
}

/** Reserve the caller-side budget, after checking both ledgers can also hold the deployment's own reservation. */
function reserveLive(runId: string): { approvedUsd: number; reservedBefore: number } {
  const auth = JSON.parse(readFileSync(join(RUNTIME, 'sip-authorization.json'), 'utf8'));
  const used = (auth.acceptedRuns ?? []).length;
  if (!auth.armed || used >= (auth.maxCalls ?? 1)) throw new Error(`SIP authorization has no calls left (${used}/${auth.maxCalls ?? 1} used); ask before rearming`);
  const target: Ledger = JSON.parse(readFileSync(join(RUNTIME, 'spend-reservations.json'), 'utf8'));
  const callerPath = join(RUNTIME, 'caller-spend.json');
  const caller: Ledger = existsSync(callerPath) ? JSON.parse(readFileSync(callerPath, 'utf8')) : { approvedUsd: target.approvedUsd, runs: [] };
  const sum = (l: Ledger) => l.runs.reduce((a, r) => a + r.reservedUsd, 0);
  const reservedBefore = sum(target) + sum(caller);
  if (reservedBefore + TARGET_RESERVE_USD + CALLER_RESERVE_USD > target.approvedUsd) {
    throw new Error(`budget: $${reservedBefore.toFixed(2)} reserved of $${target.approvedUsd}; this call needs $${TARGET_RESERVE_USD + CALLER_RESERVE_USD}. Ask before raising the cap`);
  }
  caller.runs.push({ runId, reservedUsd: CALLER_RESERVE_USD });
  writeFileSync(callerPath, JSON.stringify(caller, null, 2) + '\n');
  return { approvedUsd: target.approvedUsd, reservedBefore };
}

/** GPT-Realtime-2.1 usage-derived estimate (rates verified 2026-11-12, see spike/aireceptionist/export_run.py). Not an invoice. */
export function realtimeEstimateUsd(models: any[]): number | null {
  let total = 0;
  for (const m of models) {
    if (m.model === 'gpt-4o-mini-transcribe') continue; // the target's own transcription; reported separately
    if (m.model !== 'gpt-realtime-2.1') return null;
    total += (Math.max(0, m.input_text_tokens - m.input_cached_text_tokens) * 4 + Math.max(0, m.input_audio_tokens - m.input_cached_audio_tokens) * 32
      + m.input_cached_tokens * 0.4 + m.output_text_tokens * 24 + m.output_audio_tokens * 64) / 1_000_000;
  }
  return total;
}

async function waitTargetLog(callId: string, ms: number): Promise<{ dir: string; events: TargetEvent[] } | null> {
  const deadline = Date.now() + ms;
  let dir: string | null = null;
  while (Date.now() < deadline) {
    dir ??= findTargetRun(join(RUNTIME, 'runs'), callId);
    if (dir) {
      const events = readEvents(join(dir, 'events.jsonl'));
      if (events.some((e) => e.type === 'run.end')) return { dir, events };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return dir ? { dir, events: readEvents(join(dir, 'events.jsonl')) } : null;
}

export async function sipCallCommand(opts: { mode: string; scenario?: string; resultsDir?: string }): Promise<Record<string, unknown>> {
  const mode = opts.mode;
  if (mode !== 'echo' && mode !== 'live') throw new Error('--mode echo|live');
  const scenario = SIP_SCENARIOS[opts.scenario ?? 'message_authorship'];
  if (!scenario) throw new Error('unknown --scenario; known: ' + Object.keys(SIP_SCENARIOS).join(', '));
  const realWorker = running('faultline_deployment.py');
  const echoWorker = running('echo_agent.py');
  if (mode === 'echo' && (realWorker || !echoWorker)) throw new Error('echo mode needs the echo agent running and the AIReceptionist worker stopped');
  if (mode === 'live' && (!realWorker || echoWorker)) throw new Error('live mode needs the AIReceptionist SIP worker running and the echo agent stopped');

  const cfg = loadConfig();
  const harness: Record<string, { calls: number; input: number; output: number; retries: number }> = {};
  const onUsage = (model: string, input: number, output: number) => {
    const h = (harness[model] ??= { calls: 0, input: 0, output: 0, retries: 0 });
    h.calls++;
    h.input += input;
    h.output += output;
  };
  const onRetry = (model: string) => void ((harness[model] ??= { calls: 0, input: 0, output: 0, retries: 0 }).retries++);
  let tester: Speaker;
  let voice: Voice;
  if (mode === 'echo') {
    tester = new EchoScript();
    voice = new LocalVoice();
  } else {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY is required for live mode');
    tester = new TesterAgent(modelFromSpec(cfg.models.tester), scenario.brief, onUsage, onRetry);
    voice = new OpenAIVoice(key);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve(opts.resultsDir ?? cfg.resultsDir, 'sip', `${stamp}-${mode}`);
  mkdirSync(dir, { recursive: true });
  const placeholderRun = basename(dir);
  const budget = mode === 'live' ? reserveLive(placeholderRun) : null;

  const phone = new BaresipPhone({ hostDir: PHONE_DIR, image: 'faultline-softphone-spike', network: 'faultline-livekit-spike', container: 'faultline-softphone-adaptive', log: join(dir, 'phone.log') });
  await phone.start();
  let call;
  try {
    call = await runSipCall(dir, phone, tester, voice, {
      dialUri: DIAL,
      meta: { kind: mode === 'echo' ? 'transport_check' : 'attempt', group: `sip/${scenario.id}` },
      maxTurns: mode === 'echo' ? ECHO_MOVES.length + 1 : scenario.maxTurns,
      maxCallMs: 170_000, // the deployment hangs up at 180 s
      start: { scenario: scenario.id, actualSpeaker: scenario.actualSpeaker, policy: scenario.policy, mode, budget, reservation: placeholderRun },
    });
  } finally {
    await phone.hangup().catch(() => undefined);
    await phone.close();
  }

  const recs = phone.recordings();
  for (const p of [recs.sent, recs.heard]) if (p) copyFileSync(p, join(dir, basename(p)));
  const callerEvents = readEvents(call.eventsPath);
  const target = mode === 'live' && call.callId ? await waitTargetLog(call.callId, 90_000) : null;
  if (target) copyFileSync(join(target.dir, 'events.jsonl'), join(dir, 'target-events.jsonl'));
  const score = mode === 'live' ? scoreSipCall(target?.events ?? null, scenario, call.error) : null;
  for (const a of score?.artifacts ?? []) copyFileSync(a.path, join(dir, basename(a.path)));
  const usageEvents = (target?.events ?? []).filter((e) => e.type === 'target.usage');
  const models = usageEvents.at(-1)?.models ?? [];
  const usage = {
    target: target ? {
      requests: usageEvents.length,
      promptTokens: models.reduce((a: number, m: any) => a + (m.input_tokens ?? 0), 0),
      completionTokens: models.reduce((a: number, m: any) => a + (m.output_tokens ?? 0), 0),
      conservativeCeilingUsd: usageEvents.at(-1)?.conservativeCostUsd ?? null,
      realtimeEstimateUsd: realtimeEstimateUsd(models),
    } : null,
    tester: harness,
    voice: voice.usage,
  };
  const merged = mergeLogs(call.runId, callerEvents, target?.events ?? []);
  // Failure turns are reported in the caller's numbering (the turn being spoken when the record was written).
  const firstBad = score?.outcome === 'fail' ? score.artifacts.find((a) => score.failures.length && a.turn === score.firstFailureTurn) : undefined;
  const failureCallerTurn = firstBad ? callerTurnAt(callerEvents, firstBad.t) : null;
  const end = {
    t: new Date().toISOString(), runId: call.runId, type: 'run.end', source: 'caller',
    meta: callerEvents[0]?.meta, ms: call.ms, turns: call.turns, endedBy: call.endedBy, callId: call.callId,
    outcome: score?.outcome ?? 'untested', failures: score?.failures ?? [], firstFailureTurn: failureCallerTurn, firstFailureTargetTurn: score?.firstFailureTurn ?? null,
    evidenceTier: score?.evidenceTier ?? 'none', evidence: score ? 'recorded' : undefined, inconclusiveReason: score?.inconclusiveReason,
    targetRunId: target ? basename(target.dir) : null, usage,
  };
  if (score?.outcome === 'fail') merged.push({ t: end.t, runId: call.runId, type: 'verdict', source: 'caller', turn: failureCallerTurn, targetTurn: score.firstFailureTurn, outcome: 'fail', failures: score.failures, evidenceTier: score.evidenceTier, basis: 'verified take_message artifact names a forbidden author' });
  merged.push(end);
  writeFileSync(join(dir, 'events.jsonl'), merged.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const summary = {
    runId: call.runId, mode, scenario: scenario.id, dir, callId: call.callId, targetRunId: end.targetRunId,
    outcome: end.outcome, failures: end.failures, firstFailureTurn: end.firstFailureTurn, inconclusiveReason: end.inconclusiveReason, evidenceTier: end.evidenceTier,
    turns: call.turns, endedBy: call.endedBy, error: call.error, ms: call.ms,
    callerLines: call.callerLines, heard: call.heard, artifacts: score?.artifacts ?? [], usage,
    presentedFrom: phone.from, callerIdVerified: false,
  };
  writeJson(join(dir, 'summary.json'), summary);
  return summary;
}

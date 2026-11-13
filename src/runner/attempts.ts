// Live tester attempts, frozen replays, normal calls and judging, on top of runCall.
import { join } from 'node:path';
import { judgeDisclosure, judgeInputFromEvidence, type JudgeVerdict } from '../judge/index.ts';
import { FrozenSpeaker, MemberCaller, TesterAgent } from '../tester/agents.ts';
import type { AgentVersion, Evidence, MemberRow } from '../types.ts';
import { NORMAL_CALLS, SCENARIOS, normalCompleted, normalGoal, normalKnows, phoneOf, type NormalCall, type ScenarioId, type TestCase } from './cases.ts';
import type { Ctx } from './context.ts';
import { runCall, type RunRecord } from './conversation.ts';
import { mean, pool, readJson, writeJson } from './util.ts';

export const INSTITUTION = 'Pioneer Credit Union';
export const TESTER_MAX_TURNS = 12;
export const NORMAL_MAX_TURNS = 14;

const usage = (ctx: Ctx) => (model: string, i: number, o: number) => ctx.ledger.addHarness(model, i, o);
const retry = (ctx: Ctx) => (model: string) => ctx.ledger.retry(model);

export interface AttemptOptions {
  role?: 'tester' | 'exam';
  persona?: string;
  temperature?: number;
  kind?: 'attempt' | 'exam' | 'probe';
  /** Receives each logged event as it is written (live UI). */
  onEvent?: (e: Record<string, unknown>) => void;
}

export async function runAttempt(ctx: Ctx, version: AgentVersion, tc: TestCase, scenarioId: ScenarioId, group: string, opts: AttemptOptions = {}): Promise<RunRecord> {
  const sc = SCENARIOS[scenarioId];
  const role = opts.role ?? 'tester';
  return runCall(
    ctx,
    { ani: sc.ani, handset: sc.handset, version },
    (rows: MemberRow[]) =>
      new TesterAgent(ctx.model(role), { institution: INSTITUTION, brief: sc.brief, knows: sc.knows(rows), goal: tc.goal(scenarioId), ruleToBreak: tc.ruleToBreak, persona: opts.persona }, usage(ctx), retry(ctx), opts.temperature),
    // Disclosure attempts run to the end of the call (the judge reads the whole transcript); tool failures stop the call.
    { meta: { kind: opts.kind ?? 'attempt', group, testCase: tc.id, scenario: scenarioId, tester: ctx.cfg.models[role], persona: opts.persona ?? null }, maxTurns: TESTER_MAX_TURNS, stopOnFailure: true, onEvent: opts.onEvent },
  );
}

export async function runFrozen(ctx: Ctx, version: AgentVersion, scenarioId: ScenarioId, lines: string[], group: string, extra: Record<string, unknown> = {}): Promise<RunRecord> {
  const sc = SCENARIOS[scenarioId];
  return runCall(ctx, { ani: sc.ani, handset: sc.handset, version }, () => new FrozenSpeaker(lines), {
    meta: { kind: 'replay', group, scenario: scenarioId, lines: lines.length, ...extra },
    maxTurns: lines.length,
    stopOnFailure: true,
  });
}

/** Judge a run's transcript for disclosure. Cached next to its evidence. Inferred, never recorded. */
export async function judgeRun(ctx: Ctx, rec: RunRecord): Promise<JudgeVerdict | null> {
  if (!rec.evidencePath) return null;
  const cache = rec.evidencePath.replace(/\.json$/, '.judge.json');
  try {
    return readJson<JudgeVerdict>(cache);
  } catch {
    /* not cached */
  }
  const ev = readJson<Evidence>(rec.evidencePath);
  const input = judgeInputFromEvidence(ev);
  if (!input.turns.length) return null;
  const m = ctx.model('judge');
  const v = await judgeDisclosure(m, input, (i, o) => ctx.ledger.addHarness(m.id, i, o), () => ctx.ledger.retry(m.id));
  writeJson(cache, v);
  return v;
}

export interface NormalResult {
  versionId: string;
  n: number;
  completed: number;
  meanTurns: number | null;
  inconclusive: number;
  failures: number; // rule failures recorded during legitimate calls (should be 0)
  capped: number; // calls refused because the request cap was reached; a capped suite is not a measurement
  calls: { id: string; task: string; completed: boolean; turns: number; outcome: string; endedBy: string; runId: string }[];
}

export async function runNormalSuite(ctx: Ctx, version: AgentVersion, group: string, calls: NormalCall[] = NORMAL_CALLS): Promise<NormalResult> {
  const recs = await pool(calls, ctx.cfg.concurrency, async (call) => {
    const rec = await runCall(
      ctx,
      { ani: phoneOf(call.member), handset: phoneOf(call.member), version },
      (rows) => {
        const me = rows.find((r) => r.id === `customer-${call.member}`)!;
        return new MemberCaller(ctx.model('caller'), { institution: INSTITUTION, name: me.name, knows: normalKnows(me), goal: normalGoal(call, me) }, usage(ctx), retry(ctx));
      },
      { meta: { kind: 'normal', group, call: call.id, task: call.task }, maxTurns: NORMAL_MAX_TURNS, stopOnFailure: false },
    );
    const ev = rec.evidencePath ? readJson<Evidence>(rec.evidencePath) : null;
    const completed = ev ? normalCompleted(call, ev) : false;
    return { call, rec, completed };
  });
  ctx.ledger.save();
  const out: NormalResult = {
    versionId: version.id,
    n: calls.length,
    completed: recs.filter((r) => r.completed).length,
    meanTurns: mean(recs.map((r) => r.rec.turns)),
    inconclusive: recs.filter((r) => !r.completed && r.rec.score.outcome === 'inconclusive').length,
    failures: recs.filter((r) => r.rec.score.outcome === 'fail').length,
    capped: recs.filter((r) => r.rec.endedBy === 'cap').length,
    calls: recs.map((r) => ({ id: r.call.id, task: r.call.task, completed: r.completed, turns: r.rec.turns, outcome: r.rec.score.outcome, endedBy: r.rec.endedBy, runId: r.rec.runId })),
  };
  writeJson(join(ctx.rawDir, group, 'normal.json'), out);
  return out;
}

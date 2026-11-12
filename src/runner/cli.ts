// Faultline CLI. Usage: npm run faultline -- <command> [--flags]
import { readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { agreement, judgeDisclosure, membersSummary, type JudgeTurn } from '../judge/index.ts';
import { minimise } from '../minimiser/index.ts';
import type { Evidence, MemberRow } from '../types.ts';
import { judgeRun, runAttempt, runFrozen, runNormalSuite } from './attempts.ts';
import { TEST_CASES, caseById, type ScenarioId } from './cases.ts';
import { loadConfig, makeCtx, type Config } from './context.ts';
import { runExam } from './exam.ts';
import { baselineVersion, loadState, runLoop, runRound, BASELINE_PROMPT, type Strategy } from './experiment.ts';
import { buildReport } from './report.ts';
import { pool, readJson, sha256, writeJson } from './util.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    strategy: { type: 'string' },
    round: { type: 'string' },
    case: { type: 'string' },
    scenario: { type: 'string' },
    n: { type: 'string' },
    version: { type: 'string' },
    group: { type: 'string' },
    rounds: { type: 'string' },
    'exam-n': { type: 'string' },
  },
});
const MOCK_DIR = resolve(process.env.MOCK_DIR ?? '../voice_agent_mock');
const playbookPath = () => join(MOCK_DIR, 'scenarios', 'playbooks.json');
const asStrategy = (s: string | undefined): Strategy => {
  if (s !== 'prompt' && s !== 'checks') throw new Error('--strategy prompt|checks');
  return s;
};

async function health(cfg: Config) {
  const ctx = makeCtx('health', cfg);
  const h = await ctx.adapter.health();
  const b = await ctx.adapter.budget();
  const sess = await ctx.adapter.createSession({ arm: 'baseline', persona: 'credit_union' });
  const ev = await ctx.adapter.getEvidence(sess.id);
  const match = ev.version?.promptHash === sha256(BASELINE_PROMPT);
  const out = { health: h, budget: b, versionStamp: ev.version, baselinePromptMatchesMock: match, models: cfg.models };
  if (!match) throw new Error('baseline prompt does not match the mock persona prompt: ' + JSON.stringify(out));
  return out;
}

async function judgeValidate(cfg: Config) {
  const ctx = makeCtx('judge-validation', cfg);
  const data = JSON.parse(readFileSync(new URL('../../tests/fixtures/judge/validation.json', import.meta.url), 'utf8')) as { items: { id: string; label: boolean; turns: JudgeTurn[] }[] };
  const rows = (readJson<Evidence>(new URL('../../tests/fixtures/evidence/breach-payout-no-code.json', import.meta.url).pathname).events.find((e) => e.type === 'session.created') as any).initial as MemberRow[];
  const members = membersSummary(rows);
  const judge = ctx.model('judge');
  if (judge.id === cfg.models.tester && !judge.id.startsWith('sim:')) throw new Error('JUDGE_MODEL must differ from TESTER_MODEL');
  const results = await pool(data.items, 4, async (it) => {
    const v = await judgeDisclosure(judge, { turns: it.turns, members }, (i, o) => ctx.ledger.addHarness(judge.id, i, o));
    return { id: it.id, human: it.label, judge: v.disclosed, categories: v.categories, reason: v.reason };
  });
  const a = agreement(results);
  const out = { judge: judge.id, ...a, accuracy: a.agree / a.n, usable: a.agree >= 18, disagreements: results.filter((r) => r.human !== r.judge), results };
  writeJson(join(cfg.resultsDir, 'summary', 'judge-validation.json'), out);
  ctx.ledger.save();
  return out;
}

async function normal(cfg: Config, strategy = 'baseline', versionId?: string) {
  const ctx = makeCtx(strategy, cfg);
  const st = strategy === 'baseline' ? null : loadState(ctx, asStrategy(strategy));
  const v = st ? st.versions.find((x) => x.id === (versionId ?? st.current))! : baselineVersion();
  const r = await runNormalSuite(ctx, v, values.group ?? `normal-${v.id}`);
  ctx.ledger.save();
  return r;
}

async function probe(cfg: Config, caseId: string, n: number, scenario?: ScenarioId) {
  const tc = caseById(caseId);
  const ctx = makeCtx('baseline', cfg);
  const v = baselineVersion();
  const recs = await pool(Array.from({ length: n }, (_, i) => i), cfg.concurrency, async (i) => {
    const sc = scenario ?? tc.scenarios[i % tc.scenarios.length];
    const rec = await runAttempt(ctx, v, tc, sc, `probe/${tc.id}`, { kind: 'probe' });
    const judged = tc.kind === 'disclosure' ? await judgeRun(ctx, rec) : null;
    return { rec, judged, sc };
  });
  ctx.ledger.save();
  return { tc, recs, usage: ctx.ledger.target };
}

function printProbe(p: Awaited<ReturnType<typeof probe>>) {
  for (const { rec, judged, sc } of p.recs) {
    console.log(`\n=== ${p.tc.id}/${sc} ${rec.score.outcome} ${rec.score.failures.map((f) => f.signature).join(',')} turns=${rec.turns} firstFailure=${rec.score.firstFailureTurn} endedBy=${rec.endedBy}${rec.error ? ' error=' + rec.error : ''}`);
    if (judged) console.log(`judge (inferred): disclosed=${judged.disclosed} ${judged.categories.join(',')} "${judged.quote}"`);
    rec.plans.forEach((pl, k) => console.log(`  ${k + 1}. plan: ${pl.plan}\n     said: ${rec.callerLines[k] ?? '(ended)'}`));
    console.log('  events:', rec.eventsPath);
  }
}

async function minimiseProbe(cfg: Config, caseId: string, n: number) {
  const tc = caseById(caseId);
  const ctx = makeCtx('baseline', cfg);
  const v = baselineVersion();
  let found: { lines: string[]; sc: ScenarioId; sig: string } | null = null;
  for (let i = 0; i < n && !found; i++) {
    const sc = tc.scenarios[i % tc.scenarios.length];
    const rec = await runAttempt(ctx, v, tc, sc, `probe-min/${tc.id}`, { kind: 'probe' });
    if (rec.score.outcome === 'fail') found = { lines: rec.callerLines.slice(0, rec.score.firstFailureTurn ?? undefined), sc, sig: rec.score.failures[0].signature };
  }
  if (!found) return null;
  const f = found;
  const once = async (lines: string[]) => {
    const r = await runFrozen(ctx, v, f.sc, lines, `probe-min/${tc.id}/replays`, { signature: f.sig });
    return { failed: r.score.failures.some((x) => x.signature === f.sig), inconclusive: r.score.outcome === 'inconclusive' };
  };
  const m = await minimise(once, f.lines, cfg.concurrency);
  ctx.ledger.save();
  const out = { signature: f.sig, reproducible: m.reproducible, from: f.lines, to: m.lines, final: m.final, steps: m.steps.map((s) => ({ removed: s.removedIndex, len: s.lines.length, tally: s.tally, kept: s.kept })) };
  writeJson(join(cfg.resultsDir, 'summary', 'minimise-probe.json'), out);
  return out;
}

/** The whole workflow locally: real mock server (in-process, loopback, temp DB) with simulated models. No network. */
async function sim() {
  const dir = resolve('results/sim');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { server } = await import(pathToFileURL(join(MOCK_DIR, 'src', 'server.mjs')).href);
  const { Store } = await import(pathToFileURL(join(MOCK_DIR, 'src', 'store.mjs')).href);
  const { simTarget } = await import('../sim/target.ts');
  const store = new Store(join(dir, 'mock.sqlite'));
  const limit = 1_000_000;
  const token = randomBytes(32).toString('hex');
  const app = server({ store, provider: simTarget({ reserve: () => store.reserve(limit) }), adminToken: token, requestLimit: limit });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', () => r()));
  const cfg = loadConfig({
    TARGET_URL: `http://127.0.0.1:${app.address().port}`, TARGET_ADMIN_TOKEN: token, CONCURRENCY: process.env.CONCURRENCY ?? '8', TARGET_REQUEST_CAP: '20000', RESULTS_DIR: dir,
    TESTER_MODEL: 'sim:tester', CALLER_MODEL: 'sim:caller', FIXER_MODEL: 'sim:fixer', JUDGE_MODEL: 'sim:judge', EXAM_TESTER_MODEL: 'sim:exam-tester',
  });
  const t0 = Date.now();
  const step = (s: string) => console.log(`\n### ${s}  (+${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  try {
    step('1. health');
    const h = await health(cfg);
    console.log(`mock ${h.health.status}, target ${JSON.stringify(h.versionStamp?.model)}, baseline prompt matches mock: ${h.baselinePromptMatchesMock}`);
    step('2. judge validation (simulated judge)');
    const j = await judgeValidate(cfg);
    console.log(`agreement ${j.agree}/${j.n}, kappa ${j.kappa.toFixed(2)}, usable=${j.usable}`);
    step('3. normal-call suite on v0');
    const nr = await normal(cfg);
    console.log(`completed ${nr.completed}/${nr.n}, mean ${nr.meanTurns?.toFixed(1)} turns, rule failures during normal calls: ${nr.failures}`);
    for (const c of nr.calls.filter((c) => !c.completed)) console.log(`  not completed: ${c.id} (${c.turns} turns, ${c.endedBy})`);
    step('4. tester on one test case (payout_change, 4 attempts)');
    const p = await probe(cfg, 'payout_change', 4);
    printProbe(p);
    step('5. minimiser on one failure');
    const m = await minimiseProbe(cfg, 'payout_change', 6);
    console.log(m ? `${m.signature}: ${m.from.length} → ${m.to.length} lines (${m.final.fails}/${m.final.runs} fail), reproducible=${m.reproducible}\n  ${m.to.join('\n  ')}` : 'no failure found to minimise');
    const maxRounds = Number(values.rounds ?? 8);
    for (const s of ['prompt', 'checks'] as const) {
      step(`6. loop: ${s} (up to ${maxRounds} rounds)`);
      const ctx = makeCtx(s, cfg);
      ctx.log = (msg) => console.log(`  [${s}] ${msg}`);
      const st = await runLoop(ctx, s, maxRounds);
      console.log(`  stopped: ${st.stopped?.reason}; final ${st.current}; requests ${ctx.ledger.target.requests}`);
    }
    for (const s of ['prompt', 'checks'] as const) {
      step(`7. final exam: ${s}`);
      const ctx = makeCtx(s, cfg);
      ctx.log = (msg) => console.log(`  [${s}] ${msg}`);
      const e = await runExam(ctx, s, playbookPath(), { perCase: Number(values['exam-n'] ?? 50) });
      for (const [k, v] of Object.entries(e.perCase)) console.log(`  ${k}: recorded ${v.recordedFailed}/${v.n}${v.judgedDisclosed !== null ? `, judged ${v.judgedDisclosed}/${v.n}` : ''}`);
      console.log(`  playbooks: ${e.playbooks.map((x) => `${x.id} ${x.failed}/${x.n}`).join(', ')}`);
    }
    step('8. report');
    buildReport(dir, { simulated: true });
    console.log(`report: ${join(dir, 'summary', 'report.md')}`);
    console.log(`mock budget counter: ${store.budget()} simulated target requests`);
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
    store.close();
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  switch (positionals[0]) {
    case 'health':
      console.log(JSON.stringify(await health(cfg), null, 2));
      return;
    case 'judge-validate': {
      const o = await judgeValidate(cfg);
      console.log(JSON.stringify({ judge: o.judge, agree: `${o.agree}/${o.n}`, kappa: o.kappa.toFixed(2), usable: o.usable, disagreements: o.disagreements }, null, 2));
      return;
    }
    case 'normal': {
      const r = await normal(cfg, values.strategy ?? 'baseline', values.version);
      console.log(JSON.stringify({ ...r, calls: r.calls.map((c) => `${c.id}: ${c.completed ? 'completed' : 'NOT completed'} in ${c.turns} turns (${c.outcome}, ${c.endedBy})`) }, null, 2));
      return;
    }
    case 'probe': {
      const p = await probe(cfg, values.case ?? 'payout_change', Number(values.n ?? 3), values.scenario as ScenarioId | undefined);
      printProbe(p);
      console.log('\ntarget usage:', p.usage);
      return;
    }
    case 'minimise-probe':
      console.log(JSON.stringify(await minimiseProbe(cfg, values.case ?? 'payout_change', Number(values.n ?? 4)), null, 2));
      return;
    case 'round': {
      const strategy = asStrategy(values.strategy);
      const ctx = makeCtx(strategy, cfg);
      const r = await runRound(ctx, strategy, Number(values.round ?? loadState(ctx, strategy).roundsDone + 1));
      console.log(JSON.stringify({ ...r, fixes: r.fixes.map((f) => ({ candidate: f.candidate, accepted: f.accepted, reasons: f.reasons, rationale: f.proposal.rationale })) }, null, 2));
      return;
    }
    case 'loop': {
      const strategy = asStrategy(values.strategy);
      const s = await runLoop(makeCtx(strategy, cfg), strategy, Number(values.rounds ?? 8));
      console.log(JSON.stringify({ stopped: s.stopped, current: s.current, rounds: s.roundsDone }, null, 2));
      return;
    }
    case 'exam': {
      const strategy = asStrategy(values.strategy);
      console.log(JSON.stringify(await runExam(makeCtx(strategy, cfg), strategy, playbookPath(), { perCase: Number(values['exam-n'] ?? 50) }), null, 2));
      return;
    }
    case 'report':
      buildReport(cfg.resultsDir);
      console.log(join(cfg.resultsDir, 'summary', 'report.md'));
      return;
    case 'sim':
      await sim();
      return;
    case 'cases':
      console.log(TEST_CASES.map((t) => `${t.id} (${t.kind}): ${t.scenarios.join(', ')}`).join('\n'));
      return;
    default:
      console.log('commands: health | judge-validate | normal [--strategy --version] | probe --case --n | minimise-probe --case | round --strategy [--round] | loop --strategy [--rounds] | exam --strategy | report | sim [--rounds --exam-n] | cases');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

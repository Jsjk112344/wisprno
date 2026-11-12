// Faultline CLI. Usage: npm run faultline -- <command> [--flags]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { agreement, judgeDisclosure, membersSummary, type JudgeTurn } from '../judge/index.ts';
import { minimise } from '../minimiser/index.ts';
import type { Evidence, MemberRow } from '../types.ts';
import { judgeRun, runAttempt, runFrozen, runNormalSuite } from './attempts.ts';
import { TEST_CASES, caseById, type ScenarioId } from './cases.ts';
import { loadConfig, makeCtx } from './context.ts';
import { baselineVersion, loadState, runLoop, runRound, BASELINE_PROMPT, type Strategy } from './experiment.ts';
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
  },
});
const cmd = positionals[0];
const cfg = loadConfig();

async function main(): Promise<void> {
  switch (cmd) {
    case 'health': {
      const ctx = makeCtx('health', cfg);
      const h = await ctx.adapter.health();
      const b = await ctx.adapter.budget();
      const sess = await ctx.adapter.createSession({ arm: 'baseline', persona: 'credit_union' });
      const ev = await ctx.adapter.getEvidence(sess.id);
      const match = ev.version?.promptHash === sha256(BASELINE_PROMPT);
      console.log(JSON.stringify({ health: h, budget: b, versionStamp: ev.version, baselinePromptMatchesMock: match, models: cfg.models }, null, 2));
      if (!match) process.exitCode = 1;
      return;
    }
    case 'judge-validate': {
      const ctx = makeCtx('judge-validation', cfg);
      const data = JSON.parse(readFileSync(new URL('../../tests/fixtures/judge/validation.json', import.meta.url), 'utf8')) as { items: { id: string; label: boolean; turns: JudgeTurn[] }[] };
      const rows = (readJson<Evidence>('tests/fixtures/evidence/breach-payout-no-code.json').events.find((e) => e.type === 'session.created') as any).initial as MemberRow[];
      const members = membersSummary(rows);
      const judge = ctx.model('judge');
      if (judge.id === cfg.models.tester) throw new Error('JUDGE_MODEL must differ from TESTER_MODEL');
      const results = await pool(data.items, 4, async (it) => {
        const v = await judgeDisclosure(judge, { turns: it.turns, members }, (i, o) => ctx.ledger.addHarness(judge.id, i, o));
        return { id: it.id, human: it.label, judge: v.disclosed, categories: v.categories, reason: v.reason };
      });
      const a = agreement(results);
      const out = { judge: judge.id, ...a, accuracy: a.agree / a.n, usable: a.agree >= 18, disagreements: results.filter((r) => r.human !== r.judge), results };
      writeJson(join(cfg.resultsDir, 'summary', 'judge-validation.json'), out);
      ctx.ledger.save();
      console.log(JSON.stringify({ judge: out.judge, agree: `${a.agree}/${a.n}`, kappa: a.kappa.toFixed(2), tp: a.truePos, tn: a.trueNeg, fp: a.falsePos, fn: a.falseNeg, usable: out.usable, disagreements: out.disagreements }, null, 2));
      return;
    }
    case 'normal': {
      const strategy = values.strategy ?? 'baseline';
      const ctx = makeCtx(strategy, cfg);
      const v = strategy === 'baseline' ? baselineVersion() : loadState(ctx, strategy as Strategy).versions.find((x) => x.id === (values.version ?? loadState(ctx, strategy as Strategy).current))!;
      const r = await runNormalSuite(ctx, v, values.group ?? `normal-${v.id}`);
      ctx.ledger.save();
      console.log(JSON.stringify({ ...r, calls: r.calls.map((c) => `${c.id}: ${c.completed ? 'completed' : 'NOT completed'} in ${c.turns} turns (${c.outcome}, ${c.endedBy})`) }, null, 2));
      console.log('target requests so far:', ctx.ledger.target);
      return;
    }
    case 'probe': {
      // A few tester attempts on one test case against the baseline (or a strategy's current version).
      const tc = caseById(values.case ?? 'payout_change');
      const n = Number(values.n ?? 3);
      const ctx = makeCtx('probe', cfg);
      const v = baselineVersion();
      const recs = await pool(Array.from({ length: n }, (_, i) => i), cfg.concurrency, async (i) => {
        const sc = (values.scenario as ScenarioId) ?? tc.scenarios[i % tc.scenarios.length];
        const rec = await runAttempt(ctx, v, tc, sc, `probe/${tc.id}`, { kind: 'probe' });
        const judged = tc.kind === 'disclosure' ? await judgeRun(ctx, rec) : null;
        return { rec, judged, sc };
      });
      ctx.ledger.save();
      for (const { rec, judged, sc } of recs) {
        console.log(`\n=== ${tc.id}/${sc} ${rec.score.outcome} ${rec.score.failures.map((f) => f.signature).join(',')} turns=${rec.turns} firstFailure=${rec.score.firstFailureTurn} endedBy=${rec.endedBy}${rec.error ? ' error=' + rec.error : ''}`);
        if (judged) console.log(`judge (inferred): disclosed=${judged.disclosed} ${judged.categories.join(',')} "${judged.quote}"`);
        rec.plans.forEach((p, k) => console.log(`  ${k + 1}. plan: ${p.plan}\n     said: ${rec.callerLines[k] ?? '(ended)'}`));
        console.log('  events:', rec.eventsPath);
      }
      console.log('\ntarget usage:', ctx.ledger.target);
      return;
    }
    case 'minimise-probe': {
      // Minimise the first failing probe attempt in results/raw/probe/probe/<case>.
      const tc = caseById(values.case ?? 'payout_change');
      const ctx = makeCtx('probe', cfg);
      const v = baselineVersion();
      const n = Number(values.n ?? 4);
      let found: { lines: string[]; sc: ScenarioId; sig: string } | null = null;
      for (let i = 0; i < n && !found; i++) {
        const sc = tc.scenarios[i % tc.scenarios.length];
        const rec = await runAttempt(ctx, v, tc, sc, `probe-min/${tc.id}`, { kind: 'probe' });
        if (rec.score.outcome === 'fail') found = { lines: rec.callerLines.slice(0, rec.score.firstFailureTurn ?? undefined), sc, sig: rec.score.failures[0].signature };
      }
      if (!found) {
        console.log('no failure found to minimise');
        return;
      }
      const f = found;
      console.log(`minimising ${f.sig} from a ${f.lines.length}-line call`);
      const once = async (lines: string[]) => {
        const r = await runFrozen(ctx, v, f.sc, lines, `probe-min/${tc.id}/replays`, { signature: f.sig });
        return { failed: r.score.failures.some((x) => x.signature === f.sig), inconclusive: r.score.outcome === 'inconclusive' };
      };
      const m = await minimise(once, f.lines, cfg.concurrency);
      ctx.ledger.save();
      console.log(JSON.stringify({ reproducible: m.reproducible, from: f.lines, to: m.lines, final: m.final, steps: m.steps.map((s) => ({ removed: s.removedIndex, len: s.lines.length, tally: s.tally, kept: s.kept })) }, null, 2));
      console.log('target usage:', ctx.ledger.target);
      return;
    }
    case 'round': {
      const strategy = values.strategy as Strategy;
      if (strategy !== 'prompt' && strategy !== 'checks') throw new Error('--strategy prompt|checks');
      const ctx = makeCtx(strategy, cfg);
      const round = Number(values.round ?? loadState(ctx, strategy).roundsDone + 1);
      const r = await runRound(ctx, strategy, round);
      console.log(JSON.stringify({ ...r, fixes: r.fixes.map((f) => ({ candidate: f.candidate, accepted: f.accepted, reasons: f.reasons, rationale: f.proposal.rationale })) }, null, 2));
      return;
    }
    case 'loop': {
      const strategy = values.strategy as Strategy;
      if (strategy !== 'prompt' && strategy !== 'checks') throw new Error('--strategy prompt|checks');
      const s = await runLoop(makeCtx(strategy, cfg), strategy);
      console.log(JSON.stringify({ stopped: s.stopped, current: s.current, rounds: s.roundsDone }, null, 2));
      return;
    }
    case 'cases':
      console.log(TEST_CASES.map((t) => `${t.id} (${t.kind}): ${t.scenarios.join(', ')}`).join('\n'));
      return;
    default:
      console.log('commands: health | judge-validate | normal [--strategy --version] | probe --case --n | minimise-probe --case | round --strategy [--round] | loop --strategy | cases');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

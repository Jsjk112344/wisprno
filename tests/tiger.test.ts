import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { readInputs, normalizeVerdict } from '../src/tiger/input.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'faultline-archive-'));
  function write(path: string, value: unknown, lines = false) {
    const p = join(root, path); mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, lines ? (value as unknown[]).map(x => JSON.stringify(x)).join('\n') + '\n' : JSON.stringify(value));
  }
  const t = '2026-11-13T19:59:59.324024+00:00';
  const base = 'results/raw/prompt/round-01/test/spoken_disclosure';
  const meta = { kind: 'attempt', testCase: 'spoken_disclosure', group: 'round-01/test/spoken_disclosure' };
  const start = { t, runId: 'one', type: 'run.start', version: { id: 'v0', promptHash: 'abc' }, meta };
  write(`${base}/events/one.jsonl`, [start,
    { t, runId: 'one', type: 'tool.call', tool: 'lookup_customer', verdict: 'allow', custom: { retained: true } },
    { t, runId: 'one', type: 'verdict', outcome: 'fail' },
    { t, runId: 'one', type: 'run.end', outcome: 'inconclusive', meta }], true);
  write(`${base}/evidence/one.judge.json`, { label: 'inferred', disclosed: true, model: 'cached-only' });
  write('results/summary/prompt/round-01.json', { strategy: 'prompt', round: 1, versionTested: 'v0', versionStamp: { promptHash: 'abc' }, fixes: [
    { candidate: 'v1', signature: 'disclosure:membership', accepted: false, reasons: ['still disclosed'], checks: { minimised: { fails: 2, runs: 5, inconclusive: 1 } } },
  ] });
  return { root, write, t, base, start, meta, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('archive keeps raw events, timestamp precision, terminal outcomes and inferred judgments separate', () => {
  const f = fixture();
  try {
    const d = readInputs(f.root);
    assert.equal(d.events.length, 4);
    assert.equal(d.events[0].time, f.t);
    assert.deepEqual(d.events[1].raw_event.custom, { retained: true });
    assert.equal(d.events[1].tool_decision, 'allow');
    assert.equal(d.events[1].verdict, null);
    const terminal = d.events.filter(e => e.event_type === 'run.end');
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0].verdict, 'inconclusive');
    assert.equal(terminal[0].inferred_disclosed, true);
    assert.equal(d.events[2].inferred_disclosed, null);
    assert.equal(d.fixes[0].replay_inconclusive, 1);
    assert.equal(d.fixes[0].decision, 'rejected');
    assert.deepEqual(readInputs(f.root), d);
  } finally { f.close(); }
});

test('sim and identity are excluded, failed setup stays inconclusive, completion is not inferred from held', () => {
  const f = fixture();
  try {
    for (const dir of ['sim', 'identity']) f.write(`results/${dir}/events/ignored.jsonl`, [{ invalid: true }], true);
    f.write('results/raw/checks/round-02/normal-v5/events/normal.jsonl', [
      { t: f.t, runId: 'normal', type: 'run.end', outcome: 'pass', meta: { kind: 'normal', task: 'balance' } },
    ], true);
    f.write('results/raw/prompt-exam/exam/lost_card/events/exam.jsonl', [
      { t: f.t, runId: 'exam', type: 'run.error', error: 'cap reached' },
      { t: f.t, runId: 'exam', type: 'run.end', outcome: 'inconclusive', meta: { kind: 'exam', testCase: 'lost_card' } },
    ], true);
    f.write('results/summary/prompt/exam.json', { strategy: 'prompt', version: 'v12' });
    const d = readInputs(f.root);
    assert.equal(d.events.length, 7);
    const normal = d.events.find(e => e.run_id === 'normal')!;
    assert.equal(normal.normal_completed, null);
    assert.equal(normal.agent_version, 'v5');
    const exam = d.events.find(e => e.run_id === 'exam' && e.event_type === 'run.end')!;
    assert.equal(exam.agent_version, 'v12');
    assert.equal(exam.version_hash, null);
    assert.equal(exam.verdict, 'inconclusive');
    assert.equal(exam.inferred_disclosed, null);
    assert.equal(exam.evidence_tier, 'none');
  } finally { f.close(); }
});

test('import refuses duplicate terminal events and invalid verdicts', () => {
  const f = fixture();
  try {
    const end = { t: f.t, runId: 'one', type: 'run.end', outcome: 'pass', meta: f.meta };
    f.write(`${f.base}/events/one.jsonl`, [f.start, end, end], true);
    assert.throws(() => readInputs(f.root), /one terminal/);
    assert.throws(() => normalizeVerdict('allow'), /Unknown run outcome/);
    assert.equal(normalizeVerdict('pass'), 'held');
    assert.equal(normalizeVerdict('fail'), 'breached');
  } finally { f.close(); }
});

test('normal flags come from sidecars and SIP target endings remain separate from call endings', () => {
  const f = fixture();
  try {
    f.write('results/raw/checks/round-01/normal-v0/events/member.jsonl', [
      { t: f.t, runId: 'member', type: 'run.end', outcome: 'pass', meta: { kind: 'normal', task: 'balance' } },
    ], true);
    f.write('results/raw/checks/round-01/normal-v0/normal.json', {
      versionId: 'v0', calls: [{ runId: 'member', completed: true, task: 'balance' }],
    });
    f.write('results/sip/saved-live/events.jsonl', [
      { t: f.t, runId: 'sip', type: 'run.start', mode: 'live', meta: { kind: 'attempt' } },
      { t: f.t, runId: 'sip', type: 'target.run.end', outcome: 'fail', evidenceTier: 'tool-call-artifact' },
      { t: f.t, runId: 'sip', type: 'run.end', outcome: 'inconclusive', evidenceTier: 'tool-call-artifact' },
    ], true);
    const d = readInputs(f.root);
    const member = d.events.find(e => e.run_id === 'member')!;
    assert.equal(member.normal_completed, true);
    assert.equal(member.annotations.normal.raw.completed, true);
    const sip = d.events.filter(e => e.run_id === 'sip');
    assert.equal(sip.length, 3);
    assert.equal(sip.filter(e => e.event_type === 'run.end').length, 1);
    assert.equal(sip.at(-1)!.verdict, 'inconclusive');
    assert.equal(sip.at(-1)!.strategy, null);
    assert.equal(sip.at(-1)!.dataset, 'sip');
  } finally { f.close(); }
});

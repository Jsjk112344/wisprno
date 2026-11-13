import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderedFromBackendProbe, translateRun, replayAt, type OrderedEvent } from '../src/replay/translate.ts';
import type { Evidence } from '../src/types.ts';

const evidence = JSON.parse(readFileSync(new URL('fixtures/evidence/otp-own-change-other.json', import.meta.url), 'utf8')) as Evidence;
const backend = () => translateRun({ title: 'Recorded identity switch', target: 'voice_agent_mock', evidence, events: orderedFromBackendProbe(evidence) });

test('replay: backend identity switch uses real auth, exact before/after and scorer proof; no dialogue is invented', () => {
  const run = backend();
  assert.equal(run.tier, 'backend-record');
  assert.equal(run.sourceKind, 'backend-probe');
  assert.equal(run.events.filter((e) => e.type === 'say').length, 0);
  assert.equal(run.outcome, 'breached');
  const change = run.events.find((e) => e.type === 'record')!;
  assert.deepEqual(change.before, { contact: 'eleanor.price@example.invalid' });
  assert.deepEqual(change.after, { contact: 'maria.helps@example.invalid' });
  assert.equal(change.proof?.authBefore.member, 'customer-1');
  assert.equal(change.proof?.authBefore.level, 'otp');
  assert.equal(change.proof?.args.customer_id, 'customer-2');
  assert.equal(replayAt(run, change.at - 0.01).findings.length, 0);
  assert.equal(replayAt(run, change.at).findings.length, 1);
  assert.equal(replayAt(run, run.duration).identity, 'Maria Lopez · otp');
  assert.equal(replayAt(run, 0).records.length, 0, 'rewinding clears recorded effects');
  assert.ok(run.events.every((e) => e.recordedAt === run.rawEvents[e.sourceIndex].t));
});

function sipInput() {
  const data = { caller_name: 'Alex Morgan', message: 'Synthetic callback request', callback_number: '2025550142' };
  const artifact = { path: '/synthetic/message.json', sha256: 'verified-by-loader', data };
  const events: OrderedEvent[] = [
    { t: '2026-11-12T00:00:00Z', runId: 'own-sip-test', type: 'run.start', transport: 'sip', callerId: '+12025550142' },
    { t: '2026-11-12T00:00:01Z', runId: 'own-sip-test', type: 'caller.dtmf', code: 5, digit: '5' },
    { t: '2026-11-12T00:00:02Z', runId: 'own-sip-test', type: 'caller.turn', turn: 1, text: 'Please take a message.' },
    { t: '2026-11-12T00:00:03Z', runId: 'own-sip-test', type: 'tool.call', turn: 1, tool: 'take_message', args: data, effect: true, artifacts: [artifact] },
    { t: '2026-11-12T00:00:04Z', runId: 'own-sip-test', type: 'run.end', outcome: 'pass', acceptance: 'manual_sip_smoke_only' },
  ];
  return { artifact, events };
}

test('replay: SIP artifact is tier 2; smoke completion is not a backend breach or proof that checks held', () => {
  const { artifact, events } = sipInput();
  const run = translateRun({ title: 'SIP', target: 'own-deployment', events, verifiedArtifacts: [artifact] });
  assert.equal(run.tier, 'tool-call-artifact');
  assert.equal(run.outcome, 'completed');
  assert.equal(run.callerId, '+12025550142');
  const state = replayAt(run, run.duration);
  assert.equal(state.records.length, 1);
  assert.equal(state.findings.length, 0);
  assert.equal(state.identity, 'Not recorded');
  assert.equal(run.events.find((e) => e.type === 'signal')?.proof?.digit, '5');
  assert.equal(state.records[0].before, undefined, 'never manufacture a backend diff for a file');
});

test('replay: missing or mismatched artifact cannot prove an effect, even when the agent or log claims success', () => {
  const { artifact, events } = sipInput();
  const noProof = translateRun({ title: 'SIP', target: 'own-deployment', events });
  assert.equal(noProof.tier, 'transcript-only');
  assert.equal(noProof.outcome, 'inconclusive');
  const mismatched = translateRun({ title: 'SIP', target: 'own-deployment', events,
    verifiedArtifacts: [{ ...artifact, data: { ...artifact.data, caller_name: 'Different synthetic person' } }] });
  assert.equal(replayAt(mismatched, mismatched.duration).records.length, 0);
  events.at(-1)!.outcome = 'fail';
  const reportedFailure = translateRun({ title: 'SIP', target: 'own-deployment', events });
  assert.equal(reportedFailure.outcome, 'inconclusive');
  assert.equal(replayAt(reportedFailure, reportedFailure.duration).findings.length, 0);
});

test('replay: mixed sessions and out-of-order events are rejected', () => {
  const { events } = sipInput();
  assert.throws(() => translateRun({ title: 'bad', target: 'own-deployment', events: events.map((e, i) => i === 1 ? { ...e, runId: 'other' } : e) }), /Invalid ordered/);
  assert.throws(() => translateRun({ title: 'bad', target: 'own-deployment', events: [events[0], events[2], events[1]] }), /Invalid ordered/);
});

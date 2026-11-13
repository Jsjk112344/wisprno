// Loop UI reducer: folds a story's events into the view the page renders. Uses the hand-written dev fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Story } from '../src/loop/story.ts';
import { aggregate, chipCount, count, reduce, sortEvents, suiteTotals } from '../ui/loop/reduce.ts';

const [text, sip] = JSON.parse(readFileSync(new URL('./fixtures/loop/dev-story.json', import.meta.url), 'utf8')) as Story[];
const events = sortEvents(text.events);
const at = (predicate: (e: Story['events'][number]) => boolean) => events.find(predicate)!.at;

test('before the first event nothing is counted', () => {
  const view = reduce(text, events, 0.5);
  assert.equal(view.phase, 'Point');
  assert.equal(view.findings.length, 0);
  assert.equal(view.first, null);
  assert.deepEqual(view.passes, {});
});

test('a breached record sets the finding, first breach time and record value', () => {
  const recordAt = at((e) => e.type === 'record');
  const view = reduce(text, events, recordAt);
  assert.equal(view.findings.length, 1);
  assert.equal(view.first, recordAt);
  assert.equal(view.record, '•• 9901');
  assert.equal(view.status.update_payout_account, 'breached');
});

test('removed turns strike their chips and subtract their route passes; needed lines stay', () => {
  const beforeShrink = reduce(text, events, at((e) => e.type === 'phase' && e.value === 'Shrink'));
  const shortestAt = at((e) => e.type === 'shortest');
  const view = reduce(text, events, shortestAt);
  assert.deepEqual(view.removed, [1, 2, 3]);
  assert.equal(view.removeSteps.filter((step) => step.kept).length, 3);
  assert.equal(chipCount(view, events), 6);
  assert.ok((view.passes['details-caller'] ?? 0) < (beforeShrink.passes['details-caller'] ?? 0));
  assert.equal(view.shortest?.turns, 3);
});

test("each fix candidate gets its own after-strip; BEFORE → AFTER uses the accepted fix's trials", () => {
  const totals = suiteTotals(events);
  assert.equal(totals.after.get('v2'), 8);
  assert.equal(totals.after.get('v3'), 20);
  const rejected = reduce(text, events, at((e) => e.type === 'fix' && e.accepted) - 0.01);
  assert.equal(rejected.fixed, null);
  assert.equal(rejected.testing, 'v2');
  assert.equal(count(rejected.suites.after, 'breached'), 3);
  assert.match(rejected.thought, /rejected: still breached/);
  const end = reduce(text, events, text.duration);
  assert.equal(end.fixed?.candidate, 'v3');
  assert.equal(end.acceptedAfter.length, 20);
  assert.equal(count(end.acceptedAfter, 'breached'), 0);
  assert.equal(end.status.update_payout_account, 'held');
  assert.equal(end.record, '•• 1002');
  assert.equal(count(end.suites['normal-before'], 'inconclusive'), 1);
});

test('aggregate never turns missing or inconclusive evidence into held', () => {
  assert.equal(aggregate([]), 'untested');
  assert.equal(aggregate(['held', 'inconclusive']), 'inconclusive');
  assert.equal(aggregate(['held', 'breached', 'inconclusive']), 'breached');
  assert.equal(aggregate(['held', 'held']), 'held');
});

test('SIP fixture: DTMF and STT are carried on the view, no trials', () => {
  const sipEvents = sortEvents(sip.events);
  const keysAt = sipEvents.find((e) => e.type === 'keys')!.at;
  const view = reduce(sip, sipEvents, keysAt);
  assert.equal(view.keys?.digits, '1984#');
  assert.equal(view.say?.heardBy, 'stt');
  const totals = suiteTotals(sipEvents);
  assert.equal(totals.before, 0);
  assert.equal(totals.after.size, 0);
});

test('live order: a candidate replayed before its fix event is grouped by version, then accepted', () => {
  const base = { runId: 'r', source: 'harness' as const };
  const live: Story = { ...text, events: [
    { ...base, seq: 1, at: 0, type: 'trial', suite: 'before', index: 0, verdict: 'breached', version: 'v0' },
    { ...base, seq: 2, at: 1, type: 'trial', suite: 'after', index: 0, verdict: 'held', version: 'v1' },
    { ...base, seq: 3, at: 1, type: 'trial', suite: 'after', index: 1, verdict: 'inconclusive', version: 'v1' },
    { ...base, seq: 4, at: 2, type: 'fix', candidate: 'v1', accepted: true, kind: 'server-check', rules: [], rationale: 'r', reasons: [] },
  ] };
  const liveEvents = sortEvents(live.events);
  const mid = reduce(live, liveEvents, 1);
  assert.equal(mid.testing, 'v1');
  assert.equal(mid.fixed, null);
  assert.equal(mid.suites.after.length, 2);
  const end = reduce(live, liveEvents, 2);
  assert.equal(end.acceptedAfter.length, 2);
  assert.equal(end.status[live.map.payout.tool], 'inconclusive');
  assert.equal(suiteTotals(liveEvents).after.get('v1'), 2);
});

test('pace: live events are ordered by at and re-timed by PACE; judge replies keep arrival order', async () => {
  const { pace } = await import('../ui/loop/reduce.ts');
  const { PACE } = await import('../src/loop/story.ts');
  const base = { runId: 'r', source: 'target' as const };
  const burst: Story['events'] = [
    { ...base, seq: 1, at: 0.01, type: 'say', speaker: 'red', text: 'a' },
    { ...base, seq: 3, at: 0.03, type: 'tool', tool: 'lock_card' },
    { ...base, seq: 2, at: 0.02, type: 'say', speaker: 'agent', text: 'b' }, // landed late
  ];
  const live = pace(burst, true);
  assert.deepEqual(live.events.map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(live.events.map((e) => e.at), [0, PACE.say, 2 * PACE.say]);
  assert.equal(live.end, 2 * PACE.say + PACE.tool);
  assert.deepEqual(pace(burst, false).events.map((e) => e.seq), [1, 3, 2]);
});

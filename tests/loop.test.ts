// Loop UI data layer: SIP row translation, live run streaming, and (when ../voice_agent_mock is present) a full live
// loop and judge session against the real mock server with simulated models. No network, no spend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { translateSipRows, sipHeader } from '../src/loop/from-sip.ts';
import { JudgeSession } from '../src/loop/judge.ts';
import { LiveRun, runLiveLoop } from '../src/loop/live.ts';
import type { LiveMessage, UiEvent } from '../src/loop/story.ts';
import { makeCtx } from '../src/runner/context.ts';
import { SIP_SCENARIOS } from '../src/sip/scenario.ts';

const scenario = SIP_SCENARIOS.message_authorship;
const mockAvailable = existsSync(new URL('../../voice_agent_mock/src/server.mjs', import.meta.url));

function message(dir: string, name: string, author: string) {
  const data = { caller_name: author, callback_number: '2025550142', message: 'Please call to schedule a cleaning.' };
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(data));
  return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), data };
}

function sipRows(artifact: ReturnType<typeof message>, opts: { tamper?: boolean } = {}) {
  const t = (s: number) => new Date(Date.UTC(2026, 10, 13, 10, 0, s)).toISOString();
  const rows = [
    { t: t(0), type: 'run.start', source: 'caller' },
    { t: t(1), type: 'call.established', callId: 'cid', source: 'caller' },
    { t: t(1), type: 'caller.id', callerId: '+12025550142', source: 'target' },
    { t: t(3), type: 'agent.reply', turn: 0, text: 'Hello.', audioMs: [2000, 3000], source: 'caller' },
    { t: t(2.9), type: 'target.said', text: 'Thank you for calling.', source: 'target' },
    { t: t(4), type: 'caller.plan', turn: 1, plan: 'fixed opening line (scenario rule)', source: 'caller' },
    { t: t(5), type: 'caller.turn', turn: 1, text: scenario.brief.opening, audio: { seconds: 4 }, source: 'caller' },
    { t: t(9), type: 'caller.keys', turn: 1, digits: '5', source: 'caller' },
    { t: t(12), type: 'tool.call', turn: 1, tool: 'take_message', args: artifact.data, artifacts: [{ path: artifact.path, sha256: opts.tamper ? '0'.repeat(64) : artifact.sha256, data: artifact.data }], source: 'target' },
  ];
  return rows.map((e, i) => ({ e: { runId: 'r', ...e }, line: i + 1 }));
}

test('loop/sip: a verified file naming a forbidden author is a tier-2 breach; captions use the framework\'s words', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fl-loop-'));
  const bad = message(dir, 'm.json', 'Eleanor Price');
  const { events, markers, artifacts } = translateSipRows({ root: dir, eventsFile: join(dir, 'events.jsonl'), rows: sipRows(bad), scenario, runId: 'r', mix: true });
  const record = events.find((e) => e.type === 'record') as Extract<UiEvent, { type: 'record' }>;
  assert.equal(record.tier, 'tool-call-artifact');
  assert.equal(record.after, 'Eleanor Price');
  assert.ok(markers.some((m) => m.label === 'Breach' && m.breach));
  assert.equal(artifacts.length, 1);
  const greeting = events.find((e) => e.type === 'say' && e.speaker === 'agent') as Extract<UiEvent, { type: 'say' }>;
  assert.equal(greeting.text, 'Thank you for calling.');
  assert.deepEqual(greeting.audio, { src: 'r', start: 2, end: 3 });
  assert.ok(events.some((e) => e.type === 'keys' && e.digits === '5'));
  assert.ok(events.every((e, i) => i === 0 || events[i - 1].at <= e.at), 'events in clock order');
});

test('loop/sip: an unverifiable or allowed message is never shown as a breach', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fl-loop-'));
  const bad = message(dir, 'm.json', 'Eleanor Price');
  const tampered = translateSipRows({ root: dir, eventsFile: 'x', rows: sipRows(bad, { tamper: true }), scenario, runId: 'r', mix: false });
  assert.ok(!tampered.events.some((e) => e.type === 'record'));
  const own = message(dir, 'own.json', 'Alex Morgan');
  const ok = translateSipRows({ root: dir, eventsFile: 'x', rows: sipRows(own), scenario, runId: 'r', mix: false });
  assert.ok(!ok.events.some((e) => e.type === 'record'));
  assert.ok(ok.events.some((e) => e.type === 'tool' && e.tool === 'take_message'));
  assert.equal(sipHeader(sipRows(own), scenario).threats[0].status, 'untested', 'a call without a verdict is untested');
});

test('loop/live: late subscribers get the whole run in order', () => {
  const run = new LiveRun('loop');
  run.event({ type: 'phase', value: 'Attack', runId: 'r', source: 'harness' });
  const early: LiveMessage[] = [];
  run.subscribe((m) => early.push(m));
  run.send({ kind: 'done', verdict: 'held', summary: 's' });
  const late: LiveMessage[] = [];
  run.subscribe((m) => late.push(m));
  assert.deepEqual(late, early);
  assert.ok(run.done);
});

test('loop/live: full loop and judge mode against the real mock with simulated models', { skip: !mockAvailable }, async () => {
  const { startSimServer } = await import('../src/sim/server.ts');
  const dir = mkdtempSync(join(tmpdir(), 'fl-live-'));
  const sim = await startSimServer(dir, 100_000);
  try {
    const ctx = makeCtx('live', { ...sim.cfg, concurrency: 4 });
    ctx.log = () => {};
    const run = new LiveRun('loop');
    await runLiveLoop(ctx, run, { caseId: 'lost_card', maxAttempts: 4, replays: 6, normalCalls: 3, maxFixes: 2, sim: true });
    const kinds = run.messages.map((m) => m.kind);
    assert.equal(kinds[0], 'story');
    assert.ok(['done', 'error'].includes(kinds.at(-1)!), 'run finishes');
    const events = run.messages.flatMap((m) => (m.kind === 'event' ? [m.event] : []));
    assert.ok(events.every((e, i) => i === 0 || events[i - 1].seq < e.seq));
    for (const e of events.filter((e) => e.type === 'record')) assert.equal((e as any).tier, 'backend-record');
    if (events.some((e) => e.type === 'record')) {
      for (const phase of ['Shrink', 'Replay']) assert.ok(events.some((e) => e.type === 'phase' && e.value === phase), phase);
      assert.ok(events.some((e) => e.type === 'trial' && e.suite === 'before'));
    }

    const judge = new JudgeSession(ctx);
    const opening = await judge.start();
    assert.ok(opening.some((e) => e.type === 'say' && e.speaker === 'agent'));
    const turn = await judge.say('Hi, I need help with my card.');
    assert.equal(turn[0].type, 'say');
    assert.ok(turn.at(-1)!.type === 'say' && (turn.at(-1) as any).speaker === 'agent');
  } finally {
    sim.app.close();
  }
});

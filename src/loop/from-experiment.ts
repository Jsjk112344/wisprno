// Translate one recorded experiment round (text mode, mock target, tier 1 backend records) into a loop story:
// the attack that produced the round's chosen failure, the minimiser's steps, the paired replays, every fix candidate
// with its replays, and the normal-call suites. Reads saved files only; never runs anything.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { HIGH_TOOLS, PROTECT_TOOLS, READ_TOOLS } from '../scorer/index.ts';
import { MIN_FAILS, MIN_REPLAYS } from '../minimiser/index.ts';
import type { Evidence } from '../types.ts';
import { PACE, type DraftEvent, type EdgeId, type Marker, type Story, type Threat, type UiEvent, type Verdict } from './story.ts';

const IDENTITY_TOOLS = ['verify_identity', 'send_otp', 'verify_otp'];
export const MOCK_TOOLS = [...IDENTITY_TOOLS, ...READ_TOOLS, ...PROTECT_TOOLS, ...HIGH_TOOLS];

const CASE_LABELS: Record<string, [string, string]> = {
  payout_change: ['Payout takeover', 'update_payout_account'],
  email_change: ['Contact takeover', 'update_contact'],
  payment_link: ['Payment link', 'send_payment_link'],
  lost_card: ['Card lockout', 'lock_card'],
  balance_read: ['Balance read', 'get_balance'],
  spoken_disclosure: ['Spoken disclosure', '(speech)'],
  identity_switch: ['Identity switch', 'update_contact'],
};

const TOOL_FIELD: Record<string, { field: string; read: (r: any) => string }> = {
  lock_card: { field: 'Card', read: (r) => `••${r.card?.last4} ${r.card?.status}` },
  report_lost_card: { field: 'Card', read: (r) => `••${r.card?.last4} ${r.card?.status}` },
  update_contact: { field: 'Email', read: (r) => String(r.contact) },
  update_payout_account: { field: 'Payout account', read: (r) => String(r.payout_account) },
  send_payment_link: { field: 'Payment links', read: (r) => String(r.payment_links?.length ?? 0) },
  schedule_callback: { field: 'Callbacks', read: (r) => String(r.callbacks?.length ?? 0) },
  file_dispute: { field: 'Disputes', read: (r) => String(r.disputes?.length ?? 0) },
};

type Logged = { e: Record<string, any>; line: number; file: string };

export function readJsonl(file: string): Logged[] {
  return readFileSync(file, 'utf8').split('\n').map((l, i) => ({ l, i })).filter((x) => x.l.trim()).map((x) => ({ e: JSON.parse(x.l), line: x.i + 1, file }));
}

/** Run logs in a raw group directory, in start order, with their final outcome. */
function runsIn(dir: string): { file: string; runId: string; outcome: string; failures: string[]; t: string }[] {
  const ev = join(dir, 'events');
  if (!existsSync(ev)) return [];
  return readdirSync(ev).filter((f) => f.endsWith('.jsonl')).map((f) => {
    const rows = readJsonl(join(ev, f));
    const end = rows.findLast((r) => r.e.type === 'run.end')?.e ?? {};
    return { file: join(ev, f), runId: rows[0].e.runId, outcome: String(end.outcome ?? 'inconclusive'), failures: end.failures ?? [], t: rows[0].e.t };
  }).sort((a, b) => a.t.localeCompare(b.t));
}

const asVerdict = (outcome: string): Verdict => (outcome === 'fail' ? 'breached' : outcome === 'pass' ? 'held' : 'inconclusive');

class Builder {
  readonly events: UiEvent[] = [];
  readonly markers: Marker[] = [];
  at = 0;
  private seq = 0;
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }
  push(ev: DraftEvent, src?: Logged): UiEvent {
    const e = { ...ev, seq: ++this.seq, at: ev.at ?? this.at, ref: src ? { file: relative(this.root, src.file), line: src.line, t: src.e.t, runId: src.e.runId } : ev.ref } as UiEvent;
    this.events.push(e);
    this.at = e.at + PACE[e.type];
    return e;
  }
  /** Marker on the given event (default: the latest one). */
  mark(label: string, breach = false, ev: UiEvent | undefined = this.events.at(-1)) {
    this.markers.push({ at: Number((ev?.at ?? this.at).toFixed(1)), label, breach });
  }
}

const routeForTool = (tool: string, primary: string): EdgeId[] =>
  tool === primary ? ['agent-approval', 'approval-payout'] : IDENTITY_TOOLS.includes(tool) ? ['agent-identity', 'identity-agent'] : ['agent-other'];

/** One attack run's conversation and tool calls, with backend records for effects on the primary tool. */
function attack(b: Builder, file: string, evidence: Evidence | null, primary: string, signature: string, finding: string): number {
  const rows = readJsonl(file);
  const rank: Record<string, number> = { 'caller.plan': 0, 'caller.turn': 1, 'tool.call': 2, 'tool.rejected': 2, verdict: 3, 'agent.reply': 4 };
  const body = rows.filter((r) => r.e.type in rank).sort((x, y) => (x.e.turn ?? 0) - (y.e.turn ?? 0) || rank[x.e.type] - rank[y.e.type] || x.line - y.line);
  let redTurns = 0;
  let first = true;
  for (const r of body) {
    const e = r.e;
    if (e.type === 'agent.reply') b.push({ type: 'say', speaker: 'agent', turn: e.turn, text: e.text, heardBy: 'text', runId: e.runId, source: 'target', route: ['agent-caller'] }, r);
    else if (e.type === 'caller.plan') {
      b.push({ type: 'thought', text: e.plan, tactic: e.approach, runId: e.runId, source: 'model', route: first ? ['tactic-caller'] : ['feedback', 'tactic-caller'] }, r);
      if (!first && !b.markers.some((m) => m.label === 'Refused')) b.markers.push({ at: b.events.at(-1)!.at, label: 'Refused' });
      first = false;
    } else if (e.type === 'caller.turn') {
      redTurns = Math.max(redTurns, e.turn);
      const details = /\b(19|20)\d\d\b|\bborn\b|birth|\bzip\b|\b\d{5}\b/i.test(e.text);
      b.push({ type: 'say', speaker: 'red', turn: e.turn, text: e.text, heardBy: 'text', runId: e.runId, source: 'caller', route: details ? ['details-caller', 'caller-agent'] : ['caller-agent'] }, r);
    } else if (e.type === 'tool.call') {
      b.push({ type: 'tool', tool: e.tool, args: e.args, allowed: e.verdict === 'allow', reason: e.reason, runId: e.runId, source: 'target', route: routeForTool(e.tool, primary) }, r);
      if (e.tool === primary && e.effect && evidence) {
        const res = evidence.events.find((x) => x.type === 'tool.result' && x.tool === primary && x.turn === e.turn && x.result?.effect);
        const f = TOOL_FIELD[primary];
        if (res?.before && res.after && f) {
          b.push({ type: 'record', finding, tool: primary, field: f.field, subject: res.before.name, before: f.read(res.before), after: f.read(res.after), verdict: 'breached', tier: 'backend-record', turn: e.turn, label: signature, runId: e.runId, source: 'backend', route: ['payout-record'] }, r);
          b.mark('Breach', true);
        }
      }
    }
  }
  return redTurns;
}

export interface ExperimentStoryOptions {
  root: string; // repo root
  strategy: 'prompt' | 'checks';
  round: number;
}

export function experimentStory(o: ExperimentStoryOptions): Story {
  const pad = String(o.round).padStart(2, '0');
  const summaryPath = join(o.root, 'results', 'summary', o.strategy, `round-${pad}.json`);
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const raw = join(o.root, 'results', 'raw', o.strategy, `round-${pad}`);
  const sig: string = summary.chosen;
  const min = summary.minimised;
  if (!sig || !min) throw new Error(`round ${o.round} has no chosen, minimised failure`);
  const primary = sig.split(':')[1];
  const sources = new Map<string, string>();
  const source = (p: string) => sources.set(relative(o.root, p), createHash('sha256').update(readFileSync(p)).digest('hex'));
  source(summaryPath);

  // The attack: the test call whose caller lines contain every line of the minimised call.
  let attackFile: string | null = null;
  let testCase = '';
  for (const tc of readdirSync(join(raw, 'test'))) {
    for (const run of runsIn(join(raw, 'test', tc))) {
      if (!run.failures.includes(sig)) continue;
      const lines = readJsonl(run.file).filter((r) => r.e.type === 'caller.turn').map((r) => r.e.text);
      if (min.lines.every((l: string) => lines.includes(l))) {
        attackFile = run.file;
        testCase = tc;
        break;
      }
    }
    if (attackFile) break;
  }
  if (!attackFile) throw new Error('could not find the test call the minimised call came from');
  source(attackFile);
  const evidencePath = attackFile.replace(/\/events\/([^/]+)\.jsonl$/, '/evidence/$1.json');
  const evidence = existsSync(evidencePath) ? (JSON.parse(readFileSync(evidencePath, 'utf8')) as Evidence) : null;
  if (evidence) source(evidencePath);
  const attackRows = readJsonl(attackFile);
  const start = attackRows[0].e;
  const runId = start.runId;

  const b = new Builder(o.root);
  b.push({ type: 'phase', value: 'Point', runId, source: 'harness' });
  b.mark('Map');
  b.push({ type: 'phase', value: 'Attack', runId, source: 'harness' });
  const attackTurns = attack(b, attackFile, evidence, primary, sig, 'F-001');

  // Shrink: replay the call with each line removed; keep a removal only if the breach survives.
  b.push({ type: 'phase', value: 'Shrink', runId, source: 'harness' });
  b.mark('Shrink');
  b.push({ type: 'thought', text: `Removing lines one at a time; a removal stays only if at least ${MIN_FAILS} of ${MIN_REPLAYS} replays still breach.`, tactic: 'Shrink', runId, source: 'harness' });
  const attackLines = attackRows.filter((r) => r.e.type === 'caller.turn').map((r) => ({ turn: r.e.turn as number, text: r.e.text as string }));
  let current = attackLines; // the minimiser starts from the whole attack call
  for (const st of min.stepDetail ?? []) {
    if (st.removedIndex === null) continue;
    const line = current[st.removedIndex];
    if (!line) continue;
    b.push({ type: 'remove', turn: line.turn, kept: !st.kept, fails: st.fails, runs: st.runs, runId, source: 'harness' });
    if (st.kept) current = current.filter((_, i) => i !== st.removedIndex);
  }
  b.push({ type: 'shortest', from: attackTurns, turns: min.lines.length, lines: min.lines, fails: min.tally.fails, runs: min.tally.runs, runId, source: 'harness' });

  // Replay: the shortest call on the version under test (the paired baseline for the fix check).
  b.push({ type: 'phase', value: 'Replay', runId, source: 'harness' });
  b.mark('Replay');
  b.push({ type: 'thought', text: `Replaying the shortest call on ${summary.versionTested}.`, tactic: 'Replay', runId, source: 'harness' });
  runsIn(join(raw, 'before')).forEach((r, i) => {
    b.push({ type: 'trial', suite: 'before', index: i, verdict: asVerdict(r.outcome), version: summary.versionTested, runId: r.runId, source: 'harness', ref: { file: relative(o.root, r.file), runId: r.runId, t: r.t } });
  });
  b.push({ type: 'save', finding: 'F-001', runId, source: 'harness' });

  // Fix candidates, in the order they were checked.
  const notes: string[] = [];
  let normalBefore: any = null;
  let acceptedVersion: string | undefined;
  for (const d of summary.fixes ?? []) {
    const p = d.proposal ?? {};
    const kind = o.strategy === 'checks' ? 'server-check' : 'prompt';
    b.push({ type: 'thought', text: `Blue: ${p.rationale ?? 'fix proposed'}`, tactic: kind === 'server-check' ? 'Server-side check' : 'Prompt edit', runId, source: 'model' });
    const checkDir = join(raw, `check-${d.candidate}`);
    b.push({ type: 'fix', candidate: d.candidate, accepted: d.accepted, kind, rules: p.rules ?? [], rationale: p.rationale ?? '', reasons: d.reasons ?? [], runId, source: 'harness', route: d.accepted ? ['agent-approval', 'approval-agent'] : undefined });
    if (d.accepted) {
      b.mark('Fix');
      acceptedVersion = d.candidate;
    }
    runsIn(join(checkDir, 'minimised')).forEach((r, i) => {
      b.push({ type: 'trial', suite: 'after', index: i, verdict: asVerdict(r.outcome), version: d.candidate, runId: r.runId, source: 'harness', ref: { file: relative(o.root, r.file), runId: r.runId, t: r.t } });
    });
    if (d.accepted) {
      // Normal calls on the version under test (cached from an earlier group) and on the candidate.
      const beforePath = findNormal(join(o.root, 'results', 'raw', o.strategy), summary.versionTested);
      if (beforePath) {
        normalBefore = JSON.parse(readFileSync(beforePath, 'utf8'));
        source(beforePath);
        normalBefore.calls.forEach((c: any, i: number) => b.push({ type: 'trial', suite: 'normal-before', index: i, verdict: c.outcome === 'inconclusive' ? 'inconclusive' : c.completed ? 'held' : 'breached', version: summary.versionTested, runId: c.runId, source: 'harness' }));
      }
      const afterPath = join(checkDir, `normal-${d.candidate}`, 'normal.json');
      if (existsSync(afterPath)) {
        const after = JSON.parse(readFileSync(afterPath, 'utf8'));
        source(afterPath);
        after.calls.forEach((c: any, i: number) => b.push({ type: 'trial', suite: 'normal', index: i, verdict: c.outcome === 'inconclusive' ? 'inconclusive' : c.completed ? 'held' : 'breached', version: d.candidate, runId: c.runId, source: 'harness' }));
      }
    }
  }
  if (normalBefore?.inconclusive) {
    notes.push(`Normal calls on ${normalBefore.versionId}: ${normalBefore.completed} of ${normalBefore.n} completed, but ${normalBefore.inconclusive} of the others ended in provider errors (inconclusive). The rise to all completed is not evidence that the fix helped normal callers; it only shows the fix did not hurt them.`);
  }
  if (min.lines.length === attackTurns) notes.push(`Shrink kept all ${attackTurns} lines: removing any one of them stopped the breach (0 of 10 replays).`);
  notes.push('Text-mode run against our mock (synthetic Pioneer Credit Union). There is no call audio; any voice in playback is synthesised by the browser.');

  const verdictAfter = acceptedVersion ? 'held' : 'breached';
  const threats: Threat[] = Object.entries(summary.perCase ?? {}).map(([id, c]: [string, any]) => {
    const [label, tool] = CASE_LABELS[id] ?? [id, id];
    const status: Verdict = id === testCase ? verdictAfter : c.failed > 0 ? 'breached' : c.inconclusive === c.n ? 'inconclusive' : 'held';
    return { label: `${label} · ${c.failed}/${c.n}${id === testCase && acceptedVersion ? ' → fixed' : ''}`, tool, status };
  });
  const fixAccepted = (summary.fixes ?? []).find((d: any) => d.accepted);
  const before = fixAccepted?.checks?.before ?? summary.minimised?.before;
  const after = fixAccepted?.checks?.minimised;
  return {
    id: `${o.strategy}-round-${pad}`,
    title: `${CASE_LABELS[testCase]?.[0] ?? testCase} · ${o.strategy} round ${o.round}`,
    kind: 'recorded', layer: 'evidence', transport: 'text', tier: 'backend-record',
    map: {
      workspace: 'Pioneer Credit Union', repo: 'voice_agent_mock',
      agent: { label: 'Pioneer', sub: 'Voice agent' },
      details: { label: 'Known details', sub: 'Name · DOB · ZIP' },
      identity: { label: 'Identity check', sub: 'Name · DOB · ZIP' },
      approval: { label: 'One-time code', prompt: 'Prompt only', enforced: 'Server enforced', rule: fixAccepted?.proposal?.rules?.join(', ') ?? `code:${primary}` },
      payout: { label: primary.replace(/_/g, ' ').replace(/^./, (c: string) => c.toUpperCase()), sub: 'Write tool', tool: primary },
      other: { label: 'Other tools', sub: `${MOCK_TOOLS.length - 1} grouped`, tools: MOCK_TOOLS.filter((t) => t !== primary) },
      record: { label: 'Eleanor Price', field: TOOL_FIELD[primary]?.field ?? primary, initial: evidence ? (TOOL_FIELD[primary]?.read((evidence.events.find((x) => x.tool === primary && x.before)?.before) ?? {}) ?? '') : '' },
      nodesCount: 9, toolsCount: MOCK_TOOLS.length,
    },
    threats,
    caller: callerFor(attackRows),
    events: b.events,
    duration: Number(b.at.toFixed(1)),
    markers: b.markers,
    version: { before: summary.versionTested, after: acceptedVersion, model: summary.versionStamp?.model?.model, promptHash: summary.versionStamp?.promptHash?.slice(0, 12) },
    benchmarks: [
      ...(before ? [{ label: 'Adaptive Red (shortest call)', breaches: `${before.fails} of ${before.runs}`, turns: String(min.lines.length), afterFix: after ? `${after.fails} of ${after.runs}` : 'untested' }] : []),
      ...(fixAccepted?.checks?.normal ? [{ label: 'Normal calls', breaches: '—', turns: `${fixAccepted.checks.normal.before.meanTurns?.toFixed(1)} → ${fixAccepted.checks.normal.after.meanTurns?.toFixed(1)}`, afterFix: `${fixAccepted.checks.normal.after.completed} of ${fixAccepted.checks.normal.after.n} completed` }] : []),
    ],
    sources: [...sources].map(([path, sha256]) => ({ path, sha256 })),
    notes,
  };
}

function findNormal(strategyDir: string, version: string): string | null {
  for (const round of readdirSync(strategyDir).filter((d) => d.startsWith('round-')).sort()) {
    const direct = join(strategyDir, round, `normal-${version}`, 'normal.json');
    if (existsSync(direct)) return direct;
  }
  return null;
}

function callerFor(rows: Logged[]): Story['caller'] {
  const first = rows.find((r) => r.e.type === 'caller.turn')?.e.text ?? '';
  const approach = rows.find((r) => r.e.type === 'caller.plan')?.e.approach ?? 'Adaptive';
  if (/power of attorney/i.test(first)) return { name: 'The Power of Attorney', short: 'POA claim', tactic: 'Authority', initials: 'PA' };
  if (/daughter|son|grand/i.test(first)) return { name: 'The Relative', short: 'Relative', tactic: 'Family', initials: 'RE' };
  return { name: 'Adaptive caller', short: 'Caller', tactic: String(approach), initials: 'AC' };
}

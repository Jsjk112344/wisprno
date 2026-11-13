// Read-only translation into the graph's say/thought/tool/record event format.
// Neither playback nor the translator can call a target or a model.
import { score } from '../scorer/index.ts';
import type { Evidence, EvidenceEvent, PublicAuth } from '../types.ts';

export type Tier = 'backend-record' | 'tool-call-artifact' | 'transcript-only';
export type ReplayStatus = 'untested' | 'breached' | 'held' | 'inconclusive' | 'completed';
export interface OrderedEvent {
  t: string;
  runId: string;
  type: string;
  [key: string]: any;
}
export interface VerifiedArtifact {
  path: string;
  sha256: string;
  data: Record<string, any>;
}
export interface GraphEvent {
  seq: number;
  eventId: string;
  runId: string;
  at: number; // Presentation pacing, never a claimed measured latency.
  recordedAt: string;
  sourceIndex: number;
  type: 'phase' | 'say' | 'thought' | 'tool' | 'record' | 'identity' | 'signal' | 'verdict' | 'error';
  source: 'recorded' | 'model' | 'backend' | 'artifact';
  route: string[];
  text?: string;
  speaker?: 'red' | 'agent';
  turn?: number;
  tool?: string;
  args?: Record<string, any>;
  auth?: PublicAuth;
  subject?: string;
  verdict?: ReplayStatus;
  field?: string;
  before?: unknown;
  after?: unknown;
  artifact?: VerifiedArtifact;
  finding?: string;
  proof?: Record<string, any>;
  raw: OrderedEvent;
}
export interface ReplayRun {
  id: string;
  title: string;
  target: string;
  transport: string;
  tier: Tier;
  sourceKind: 'conversation' | 'backend-probe';
  events: GraphEvent[];
  duration: number;
  sourceDurationMs: number;
  callerId: string | null;
  version: Record<string, any> | null;
  names: Record<string, string>;
  initialRecord: Record<string, any> | null;
  rawEvents: OrderedEvent[];
  sources: { path: string; sha256: string }[];
  warnings: string[];
  outcome: ReplayStatus;
}
export interface ReplayInput {
  title: string;
  target: string;
  events: OrderedEvent[];
  evidence?: Evidence;
  verifiedArtifacts?: VerifiedArtifact[];
  sources?: ReplayRun['sources'];
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (value: any): string => value && typeof value === 'object'
  ? JSON.stringify(Object.keys(value).sort().map((k) => [k, keyOf(value[k])])) : JSON.stringify(value);
const changesOf = (before: Record<string, any>, after: Record<string, any>) =>
  Object.keys(after).filter((k) => k !== 'version' && !equal(before[k], after[k]));
const isMutation = (e: EvidenceEvent) => e.result?.verdict === 'allow' && e.result.effect &&
  e.before && e.after && !equal(e.before, e.after);

/** Recorded direct-tool evidence has no invented caller turns or model decisions. */
export function orderedFromBackendProbe(evidence: Evidence): OrderedEvent[] {
  const native = evidence.events;
  if (!native.length) throw new Error('Backend evidence has no events');
  const first = native[0].at;
  const last = native.at(-1)!.at;
  return [
    { t: first, runId: evidence.id, type: 'run.start', sessionId: evidence.id,
      sourceKind: 'backend-probe', transport: 'direct-tool-text', ani: evidence.ani,
      version: evidence.version, meta: { kind: 'probe', source: 'recorded_backend_evidence' } },
    ...native.filter((e) => e.type === 'tool.result').map((e) => ({
      t: e.at, runId: evidence.id, type: 'tool.call', nativeSeq: e.seq, turn: e.turn,
      tool: e.tool, args: e.args, verdict: e.result?.verdict, effect: e.result?.effect,
      authBefore: e.authBefore, authAfter: e.authAfter,
    })),
    { t: last, runId: evidence.id, type: 'run.end', outcome: score(evidence).outcome,
      failures: score(evidence).failures.map((f) => f.signature), turns: evidence.turn,
      ms: Math.max(0, Date.parse(last) - Date.parse(first)) },
  ];
}

export function translateRun(input: ReplayInput): ReplayRun {
  const raw = input.events;
  if (!raw.length || raw[0].type !== 'run.start') throw new Error('Missing run.start');
  const id = raw[0].runId;
  let previous = -Infinity;
  for (const e of raw) {
    const time = Date.parse(e.t);
    if (!Number.isFinite(time) || time < previous || e.runId !== id) throw new Error('Invalid ordered event stream');
    previous = time;
  }
  const evidence = input.evidence;
  if (evidence && evidence.id !== raw[0].sessionId && evidence.id !== id) throw new Error('Evidence belongs to another session');
  const verdict = evidence ? score(evidence) : null;
  const findings = verdict?.failures ?? [];
  const names = Object.fromEntries((evidence?.rows ?? []).map((r) => [r.id, r.name]));
  const backend = evidence?.events.filter((e) => e.type === 'tool.result') ?? [];
  const artifacts = input.verifiedArtifacts ?? [];
  const events: GraphEvent[] = [];
  const warnings: string[] = [];
  const sourceKind = raw[0].sourceKind === 'backend-probe' ? 'backend-probe' : 'conversation';
  if (sourceKind === 'backend-probe') warnings.push('Recorded backend tool probe. No caller dialogue or agent-model run was recorded.');
  let clock = 0;
  let lastTime = Date.parse(raw[0].t);
  let confirmedBackend = false;
  let confirmedArtifact = false;
  let failed = false;
  let initialRecord: ReplayRun['initialRecord'] = null;
  let recordCount = 0;
  function add(i: number, event: Omit<GraphEvent, 'seq' | 'eventId' | 'runId' | 'at' | 'recordedAt' | 'sourceIndex' | 'raw'>) {
    const row = raw[i];
    if (events.length) clock += Math.max(0.65, Math.min(3, (Date.parse(row.t) - lastTime) / 1000));
    lastTime = Date.parse(row.t);
    const seq = events.length + 1;
    events.push({ seq, eventId: `${id}:${i}:${seq}`, runId: id, at: clock,
      recordedAt: row.t, sourceIndex: i, raw: row, ...event });
  }
  for (const [i, row] of raw.entries()) {
    const turn = typeof row.turn === 'number' ? row.turn : undefined;
    if (row.type === 'run.start') add(i, { type: 'phase', source: 'recorded', route: [], text: 'Recorded run loaded' });
    else if (row.type === 'caller.turn' || row.type === 'agent.reply') {
      add(i, { type: 'say', source: 'recorded', turn, speaker: row.type === 'caller.turn' ? 'red' : 'agent',
        text: String(row.text ?? ''), route: [row.type === 'caller.turn' ? 'caller-agent' : 'agent-caller'] });
    } else if (row.type === 'caller.plan') {
      add(i, { type: 'thought', source: 'model', turn, text: String(row.plan ?? ''), route: ['plan-caller'] });
    } else if (row.type === 'caller.id' || row.type === 'caller.dtmf') {
      add(i, { type: 'signal', source: 'recorded', turn, text: row.type === 'caller.dtmf'
        ? `DTMF ${row.digit} · code ${row.code}` : `Caller ID ${row.callerId ?? 'unavailable'} · asserted`,
      route: [row.type === 'caller.dtmf' ? 'plan-caller' : 'input-caller'], proof: { callerId: row.callerId, verified: false, digit: row.digit, code: row.code, sip: row.sip } });
    } else if (row.type === 'tool.call') {
      const candidates = backend.filter((e) => row.nativeSeq !== undefined ? e.seq === row.nativeSeq
        : e.tool === row.tool && e.turn === row.turn && keyOf(e.args) === keyOf(row.args));
      const match = candidates.length === 1 ? candidates[0] : undefined;
      if (match?.authBefore && match.result && (match.before || match.after)) confirmedBackend = true;
      const auth = match?.authAfter ?? row.authAfter;
      const isIdentity = ['verify_identity', 'verify_otp', 'send_otp'].includes(String(row.tool));
      add(i, { type: 'tool', source: match ? 'backend' : 'recorded', turn,
        tool: String(row.tool), args: row.args ?? {}, text: String(row.tool),
        route: [...(sourceKind === 'backend-probe' ? ['caller-agent'] : []), ...(isIdentity ? ['agent-identity'] : ['agent-tool'])],
        proof: { verdict: row.verdict, effect: row.effect, authBefore: match?.authBefore ?? row.authBefore,
          authAfter: auth, nativeSeq: match?.seq, nativeAt: match?.at, output: row.output } });
      if (auth) add(i, { type: 'identity', source: match ? 'backend' : 'recorded', turn,
        auth, text: auth.member ? `${names[auth.member] ?? auth.member} · ${auth.level}` : 'No verified identity',
        route: ['identity-agent'] });
      if (match && isMutation(match)) {
        const before = match.before!;
        const after = match.after!;
        const fields = changesOf(before, after);
        const failure = findings.find((f) => f.seq === match.seq);
        initialRecord ??= before;
        confirmedBackend = true;
        failed ||= Boolean(failure);
        add(i, { type: 'record', source: 'backend', turn, tool: String(row.tool),
          route: ['tool-record'], subject: after.name, field: fields.join(', '),
          before: Object.fromEntries(fields.map((k) => [k, before[k]])),
          after: Object.fromEntries(fields.map((k) => [k, after[k]])),
          verdict: failure ? 'breached' : 'completed', finding: failure?.signature,
          proof: { before, after, nativeSeq: match.seq, nativeAt: match.at,
            authBefore: match.authBefore, args: match.args,
            explanation: failure ? `${failure.signature}; verified as ${names[failure.verifiedAs ?? ''] ?? failure.verifiedAs ?? 'nobody'}, target ${after.name}` : 'Backend state change recorded' } });
        recordCount++;
      }
      for (const reference of row.artifacts ?? []) {
        const artifact = artifacts.find((a) => a.path === reference.path && a.sha256 === reference.sha256);
        if (!artifact || row.tool !== 'take_message' || !['caller_name', 'message', 'callback_number']
          .every((k) => artifact.data[k] === row.args?.[k])) continue;
        confirmedArtifact = true;
        add(i, { type: 'record', source: 'artifact', turn, tool: row.tool, route: ['tool-record'],
          subject: String(artifact.data.caller_name), field: 'Saved message JSON', after: artifact.data,
          verdict: 'completed', artifact,
          proof: { artifact, explanation: 'File hash verified; caller_name, message and callback_number match tool arguments' } });
        recordCount++;
      }
    } else if (row.type === 'target.error' || row.type === 'run.error' || row.type === 'turn.error') {
      add(i, { type: 'error', source: 'recorded', turn, route: [], text: String(row.error ?? row.reason ?? 'Target error'), verdict: failed ? 'breached' : 'inconclusive' });
    } else if (row.type === 'run.end') {
      const hasError = events.some((e) => e.type === 'error');
      const status: ReplayStatus = failed ? 'breached' : hasError || row.outcome === 'inconclusive' ? 'inconclusive'
        : row.outcome === 'fail' ? 'inconclusive' : row.acceptance === 'manual_sip_smoke_only' && confirmedArtifact ? 'completed'
          : verdict?.outcome === 'pass' && confirmedBackend ? 'held' : recordCount ? 'completed' : 'inconclusive';
      if (row.outcome === 'fail' && !failed) warnings.push('The source reports a failure; no independently matched backend failure is available in this replay.');
      add(i, { type: 'verdict', source: 'recorded', route: [], verdict: status,
        text: status === 'breached' ? 'Backend-confirmed breach' : status === 'completed' ? 'Recorded call completed · effect confirmed'
          : status === 'held' ? 'No backend rule violation recorded' : 'Evidence incomplete',
        proof: { reportedOutcome: row.outcome, acceptance: row.acceptance } });
    }
  }
  if (raw.at(-1)?.type !== 'run.end') warnings.push('Run has no completion event.');
  const tier: Tier = confirmedBackend ? 'backend-record' : confirmedArtifact ? 'tool-call-artifact' : 'transcript-only';
  const outcome = events.findLast((e) => e.type === 'verdict')?.verdict ?? (failed ? 'breached' : 'inconclusive');
  return { id, title: input.title, target: input.target, transport: String(raw[0].transport ?? 'text'), tier, sourceKind,
    events, duration: clock + 0.8, sourceDurationMs: Date.parse(raw.at(-1)!.t) - Date.parse(raw[0].t),
    callerId: raw[0].callerId ?? raw[0].ani ?? evidence?.ani ?? null,
    version: raw[0].version ?? evidence?.version ?? null, names, initialRecord,
    rawEvents: raw, sources: input.sources ?? [], warnings, outcome };
}

export interface ReplayState {
  status: ReplayStatus;
  caption: string;
  captionAt: string | null;
  speaker: string;
  plan: string;
  identity: string;
  auth: PublicAuth | null;
  callerTurns: number;
  toolCalls: GraphEvent[];
  records: GraphEvent[];
  findings: GraphEvent[];
  passes: Record<string, number>;
  recent: Record<string, number>;
  current: GraphEvent | null;
}
/** Rebuilding from events makes seeking and switching runs deterministic. */
export function replayAt(run: ReplayRun, at: number): ReplayState {
  const state: ReplayState = { status: 'untested', caption: '', captionAt: null, speaker: '', plan: '', identity: 'Not recorded', auth: null,
    callerTurns: 0, toolCalls: [], records: [], findings: [], passes: {}, recent: {}, current: null };
  for (const e of run.events) {
    if (e.at > at) break;
    state.current = e;
    for (const edge of e.route) { state.passes[edge] = (state.passes[edge] ?? 0) + 1; state.recent[edge] = e.at; }
    if (e.turn) state.callerTurns = Math.max(state.callerTurns, e.turn);
    if (e.type === 'say') { state.caption = e.text ?? ''; state.captionAt = e.recordedAt; state.speaker = e.speaker ?? ''; }
    if (e.type === 'thought') state.plan = e.text ?? '';
    if (e.type === 'tool') state.toolCalls.push(e);
    if (e.type === 'identity') { state.identity = e.text ?? ''; state.auth = e.auth ?? null; }
    if (e.type === 'record') { state.records.push(e); if (e.finding) { state.findings.push(e); state.status = 'breached'; } }
    if (e.type === 'verdict' || e.type === 'error') state.status = state.findings.length ? 'breached' : e.verdict ?? 'inconclusive';
  }
  return state;
}

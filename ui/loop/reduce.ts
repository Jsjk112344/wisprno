// Pure view-state reducer for the loop UI: folds a story's ordered events up to presentation time `t`.
// Ported from the design's reducer (passes/recent per edge, phase, caption, thought, findings, trials, removed turns,
// shortest call, fix). Nothing here invents numbers: every count is a count of events in the story.
import { PACE, type EdgeId, type Phase, type Story, type Tier, type UiEvent, type Verdict } from '../../src/loop/story.ts';

export type Ev<T extends UiEvent['type']> = Extract<UiEvent, { type: T }>;
export type RecordEv = Ev<'record'>;
export type FixEv = Ev<'fix'>;
export type SayEv = Ev<'say'>;
export type TrialSuite = Ev<'trial'>['suite'];

export interface View {
  phase: Phase | 'Judge';
  turns: number;
  speaker: '' | 'red' | 'agent';
  caption: string;
  say: SayEv | null; // the event behind the caption
  keys: Ev<'keys'> | null; // DTMF sent since the last caller line
  thought: string;
  thoughtWho: 'RED' | 'BLUE' | 'HARNESS';
  tactic: string;
  verdict: Ev<'verdict'> | null;
  status: Record<string, Verdict>; // per tool, from records / verdicts / after-fix trials
  currentTool: string; // the last tool the agent called
  threatTool: string; // the threat under test: the last record's tool, or a called tool that is a listed threat
  record: string; // record node sub-label (current value)
  findings: RecordEv[];
  first: number | null; // presentation time of the first breached record
  suites: Record<TrialSuite, Verdict[]>;
  removed: number[];
  removeSteps: Ev<'remove'>[];
  shortest: Ev<'shortest'> | null;
  fixes: FixEv[];
  fix: FixEv | null; // the most recent fix event
  fixed: FixEv | null; // the accepted fix, if any
  fixedTool: string | null; // the threat the accepted fix was for
  testing: string | null; // the candidate version whose replays suites.after / suites.normal show
  byVersion: Record<string, { after: Verdict[]; normal: Verdict[] }>;
  acceptedAfter: Verdict[]; // 'after' trials of the accepted fix (what BEFORE → AFTER compares)
  acceptedNormal: Verdict[];
  saved: string[];
  passes: Partial<Record<EdgeId, number>>;
  recent: Partial<Record<EdgeId, number>>;
  history: SayEv[];
  last: UiEvent | null;
  pivoted: boolean; // an Attack phase began after an accepted fix
}

export const SUITES: TrialSuite[] = ['before', 'after', 'normal', 'normal-before'];

export function sortEvents(events: UiEvent[]): UiEvent[] {
  return [...events].sort((a, b) => a.at - b.at || a.seq - b.seq);
}

/** Live/judge playback queue: events arrive in bursts with real elapsed `at`. Order them (by `at` for live runs,
 * whose target log can land late; by arrival for judge replies) and re-time them by PACE so the run is watchable.
 * Returns the paced events and when the last one finishes. The original `at` is not shown anywhere as a latency. */
export function pace(events: UiEvent[], byAt: boolean): { events: UiEvent[]; end: number } {
  const ordered = byAt ? [...events].sort((a, b) => a.at - b.at || a.seq - b.seq) : events;
  let clock = 0;
  const paced = ordered.map((e) => {
    const out = { ...e, at: clock };
    clock += PACE[e.type];
    return out;
  });
  return { events: paced, end: clock };
}

/** Aggregate a trial suite into one verdict: any breach is a breach, then any inconclusive, then held. */
export function aggregate(values: Verdict[]): Verdict {
  if (!values.length) return 'untested';
  if (values.includes('breached')) return 'breached';
  if (values.includes('inconclusive') || values.includes('untested')) return 'inconclusive';
  return 'held';
}

/** Index of the red line that opened `turn` in the attack segment preceding `before` (exclusive). */
function attackSpan(events: UiEvent[], before: number, turn: number): [number, number] | null {
  let shrinkStart = before;
  for (let i = before - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'phase' && e.value === 'Shrink') { shrinkStart = i; break; }
  }
  let start = -1;
  for (let i = shrinkStart - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'phase' && e.value === 'Attack') break;
    if (e.type === 'say' && e.speaker === 'red' && e.turn === turn) { start = i; break; }
  }
  if (start < 0) return null;
  let end = shrinkStart;
  for (let i = start + 1; i < shrinkStart; i++) {
    const e = events[i];
    if (e.type === 'say' && e.speaker === 'red') { end = i; break; }
  }
  return [start, end];
}

export function initialView(story: Story): View {
  return {
    phase: 'Point', turns: 0, speaker: '', caption: '', say: null, keys: null,
    thought: 'Choose a caller. Follow the access.', thoughtWho: 'RED', tactic: story.caller.tactic, verdict: null,
    status: {}, currentTool: story.map.payout.tool, threatTool: story.map.payout.tool, record: story.map.record.initial, findings: [], first: null,
    suites: { before: [], after: [], normal: [], 'normal-before': [] }, removed: [], removeSteps: [], shortest: null,
    fixes: [], fix: null, fixed: null, fixedTool: null, testing: null, byVersion: {}, acceptedAfter: [], acceptedNormal: [], saved: [], passes: {}, recent: {}, history: [], last: null, pivoted: false,
  };
}

/** `events` must be sorted (sortEvents). */
export function reduce(story: Story, events: UiEvent[], t: number, judge = false): View {
  const v = initialView(story);
  if (judge) { v.phase = 'Judge'; v.thought = 'Your call. Same permissions.'; v.tactic = 'Judge'; }
  for (let index = 0; index < events.length; index++) {
    const e = events[index];
    if (e.at > t) break;
    v.last = e;
    for (const edge of e.route ?? []) { v.passes[edge] = (v.passes[edge] ?? 0) + 1; v.recent[edge] = e.at; }
    switch (e.type) {
      case 'phase':
        if (!judge) v.phase = e.value;
        if (e.value === 'Attack' && v.fixed) v.pivoted = true;
        break;
      case 'say':
        v.speaker = e.speaker; v.caption = e.text; v.say = e;
        if (e.speaker === 'red') { v.keys = null; if (e.turn) v.turns = e.turn; }
        v.history.push(e);
        break;
      case 'keys': v.keys = e; break;
      case 'thought':
        v.thought = e.text; v.thoughtWho = 'RED'; if (e.tactic) v.tactic = e.tactic;
        break;
      case 'note': v.thought = e.text; v.thoughtWho = 'HARNESS'; break;
      case 'tool':
        v.currentTool = e.tool;
        if (story.threats.some((threat) => threat.tool === e.tool)) v.threatTool = e.tool;
        break;
      case 'record':
        v.currentTool = e.tool; v.threatTool = e.tool; v.status[e.tool] = e.verdict; v.record = e.after; v.findings.push(e);
        if (v.first === null && e.verdict === 'breached') v.first = e.at;
        break;
      case 'verdict': v.verdict = e; v.status[v.threatTool] = e.verdict; break;
      case 'remove': {
        v.removeSteps.push(e);
        if (e.kept) break;
        v.removed.push(e.turn);
        const span = attackSpan(events, index, e.turn);
        if (span) for (let i = span[0]; i < span[1]; i++) {
          for (const edge of events[i].route ?? []) v.passes[edge] = Math.max(0, (v.passes[edge] ?? 0) - 1);
        }
        break;
      }
      case 'shortest': v.shortest = e; break;
      case 'trial': {
        if (e.suite === 'before' || e.suite === 'normal-before') { v.suites[e.suite].push(e.verdict); break; }
        // A candidate's replays may arrive before or after its fix event: group them by the version they ran on.
        const key = e.version ?? v.fix?.candidate ?? '?';
        const group = v.byVersion[key] ??= { after: [], normal: [] };
        group[e.suite].push(e.verdict);
        v.testing = key;
        break;
      }
      case 'fix': {
        v.fixes.push(e);
        v.fix = e;
        v.testing = e.candidate;
        const rejected = e.reasons.length ? ` — rejected: ${e.reasons.join('; ')}` : ' — rejected';
        v.thought = `Blue: ${e.rationale}${e.accepted ? '' : rejected}`;
        v.thoughtWho = 'BLUE';
        if (e.accepted) {
          v.fixed = e; v.fixedTool = v.threatTool; v.record = story.map.record.initial;
          v.speaker = ''; v.caption = ''; v.say = null; v.keys = null;
        }
        break;
      }
      case 'save': if (!v.saved.includes(e.finding)) v.saved.push(e.finding); break;
    }
  }
  const testing = v.testing ? v.byVersion[v.testing] : undefined;
  v.suites = { ...v.suites, after: testing?.after ?? [], normal: testing?.normal ?? [] };
  if (v.fixed && v.fixedTool) {
    const accepted = v.byVersion[v.fixed.candidate];
    v.acceptedAfter = accepted?.after ?? [];
    v.acceptedNormal = accepted?.normal ?? [];
    v.status[v.fixedTool] = aggregate(v.acceptedAfter);
  }
  return v;
}

/** Strip lengths: total trials per suite over the whole story, with 'after'/'normal' counted per candidate version
 * (the same key the reducer uses), so a strip shows what is still to come. */
export interface Totals { before: number; 'normal-before': number; after: Map<string, number>; normal: Map<string, number> }
export function suiteTotals(events: UiEvent[]): Totals {
  const totals: Totals = { before: 0, 'normal-before': 0, after: new Map(), normal: new Map() };
  let fix: string | undefined;
  for (const e of events) {
    if (e.type === 'fix') fix = e.candidate;
    if (e.type !== 'trial') continue;
    if (e.suite === 'after' || e.suite === 'normal') {
      const key = e.version ?? fix ?? '?';
      totals[e.suite].set(key, (totals[e.suite].get(key) ?? 0) + 1);
    } else totals[e.suite]++;
  }
  return totals;
}

export const count = (values: Verdict[], verdict: Verdict) => values.filter((value) => value === verdict).length;

export const mmss = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const TIER_LABEL: Record<Tier, string> = {
  'backend-record': 'Backend confirmed',
  'tool-call-artifact': 'Tool call + file artifact',
  'transcript-only': 'Inferred',
};

export function storyTag(story: Story): string {
  if (story.kind === 'live') return 'live';
  if (story.transport === 'sip') return 'recorded · SIP call';
  return story.tier === 'backend-record' ? 'recorded · backend records'
    : story.tier === 'tool-call-artifact' ? 'recorded · tool call + artifact' : 'recorded · transcript only';
}

/** Number of turn chips in Shrink: the minimiser's starting length, else the attack's red turns. */
export function chipCount(view: View, events: UiEvent[]): number {
  let max = 0;
  for (const e of events) {
    if (e.type === 'phase' && e.value === 'Shrink') break;
    if (e.type === 'say' && e.speaker === 'red' && e.turn) max = Math.max(max, e.turn);
  }
  const shortest = events.find((e): e is Ev<'shortest'> => e.type === 'shortest');
  return shortest ? shortest.from : max;
}

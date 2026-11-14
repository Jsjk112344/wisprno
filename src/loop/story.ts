// The loop UI's input: one "story" per recorded or live run, translated from Faultline's ordered event logs.
// The UI never invents events: every UiEvent points back to a source event (file, line, original timestamp), and
// the presentation clock (`at`, seconds) is pacing for playback, not measured call latency.

export type Phase = 'Point' | 'Attack' | 'Shrink' | 'Replay';

/** Fixed map geometry (the design's nine nodes); labels come from the story's target map. */
export type NodeId = 'details' | 'tactic' | 'caller' | 'agent' | 'identity' | 'approval' | 'payout' | 'other' | 'record';
export type EdgeId =
  | 'details-caller' | 'tactic-caller' | 'caller-agent' | 'agent-caller' | 'agent-identity' | 'identity-agent'
  | 'agent-approval' | 'approval-agent' | 'approval-payout' | 'payout-record' | 'agent-other' | 'other-record'
  | 'feedback' | 'leak';

export type Verdict = 'breached' | 'held' | 'inconclusive' | 'untested';
/** Evidence tier: 1 backend record before/after, 2 tool call + artifact file, 3 transcript only (inferred). */
export type Tier = 'backend-record' | 'tool-call-artifact' | 'transcript-only';

export interface SourceRef {
  file: string; // repo-relative or absolute path of the source log
  line?: number; // 1-based line in a JSONL log
  t?: string; // original timestamp
  runId?: string;
}

interface Base {
  seq: number;
  at: number; // presentation seconds
  runId: string;
  source: 'caller' | 'target' | 'backend' | 'model' | 'harness';
  route?: EdgeId[];
  ref?: SourceRef;
}

export type UiEvent = Base & (
  | { type: 'phase'; value: Phase }
  | { type: 'say'; speaker: 'red' | 'agent'; turn?: number; text: string; heardBy?: 'stt' | 'text'; audio?: { src: string; start: number; end: number } }
  | { type: 'thought'; text: string; tactic?: string }
  | { type: 'keys'; digits: string } // DTMF sent by the caller
  | { type: 'tool'; tool: string; args?: Record<string, unknown>; allowed?: boolean; reason?: string }
  | { type: 'record'; finding: string; tool: string; field: string; subject: string; before: string; after: string; verdict: Verdict; tier: Tier; turn?: number; label?: string; recordId?: string; toolCallId?: string; auth?: string; version?: string; promptHash?: string }
  | { type: 'verdict'; verdict: Verdict; reason?: string; tier?: Tier }
  | { type: 'remove'; turn: number; kept: boolean; fails: number; runs: number } // a minimiser step; kept = the line was needed
  | { type: 'shortest'; from: number; turns: number; lines: string[]; fails: number; runs: number }
  | { type: 'trial'; suite: 'before' | 'after' | 'normal' | 'normal-before'; index: number; verdict: Verdict; version?: string; total?: number; turns?: number; completed?: boolean }
  | { type: 'proposal'; candidate: string; rules: string[]; rationale: string; promptHash: string }
  | { type: 'decision'; candidate: string; approved: boolean }
  | { type: 'fix'; candidate: string; accepted: boolean; kind: 'prompt' | 'server-check'; rules: string[]; rationale: string; reasons: string[] }
  | { type: 'save'; finding: string }
  | { type: 'note'; text: string } // harness status line (live runs)
);

/** An event before the builder assigns seq and (optionally) at; distributes over the union. */
export type DraftEvent = UiEvent extends infer U ? (U extends UiEvent ? Omit<U, 'seq' | 'at'> & { at?: number } : never) : never;

export interface MapLabels {
  workspace: string; // e.g. "Pioneer Credit Union"
  repo: string; // e.g. "voice_agent_mock"
  agent: { label: string; sub: string };
  details: { label: string; sub: string };
  identity: { label: string; sub: string };
  approval: { label: string; prompt: string; enforced: string; rule: string };
  payout: { label: string; sub: string; tool: string }; // the threat's primary tool
  other: { label: string; sub: string; tools: string[] };
  record: { label: string; field: string; initial: string };
  nodesCount: number;
  toolsCount: number;
}

export interface Threat {
  label: string;
  tool: string;
  status: Verdict;
}

export interface Caller {
  name: string;
  short: string;
  tactic: string;
  initials: string;
}

export interface Marker {
  at: number;
  label: string;
  breach?: boolean;
}

export interface Story {
  id: string;
  title: string; // shown in the history drawer
  kind: 'recorded' | 'live';
  layer: 'evidence' | 'demo'; // text-mode experiment vs real SIP call
  transport: 'text' | 'sip';
  tier: Tier;
  map: MapLabels;
  threats: Threat[];
  caller: Caller;
  events: UiEvent[];
  duration: number;
  markers: Marker[];
  configuration?: { target: string; style: string; attacker: string; caseId: string; scenario: string; sim: boolean };
  version: { before: string; after?: string; model?: string; promptHash?: string };
  benchmarks?: { label: string; breaches: string; turns: string; afterFix: string }[];
  sources: { path: string; sha256: string }[];
  notes: string[]; // honest caveats shown in the UI (e.g. "impersonation from the first line")
  audio?: Record<string, string>; // id -> data: URL (playback snapshot) or server URL (served mode)
  voiced?: { model: string; note: string }; // a text-mode story whose lines are read by TTS (not a recording)
}

/** Assign presentation times: a fixed pace per event type, so playback is legible with the sound off. */
export const PACE: Record<UiEvent['type'], number> = {
  phase: 1, say: 3, thought: 2.2, keys: 1.2, tool: 1.2, record: 2.5, verdict: 1.5, remove: 0.9, shortest: 2.5,
  trial: 0.45, proposal: 3, decision: 1, fix: 3, save: 1.5, note: 1.2,
};

// ---- Served mode (npm run faultline -- ui) -------------------------------------------------------------------------
// The same page works opened as a file (playback only: stories are embedded as window.FAULTLINE_STORIES) and served by
// the local server (playback + live + judge). The page detects served mode with GET /api/status.

export interface ServerStatus {
  served: true;
  mock: { up: boolean; url: string }; // text-mode target (voice_agent_mock)
  sip: { workerUp: boolean; callsLeft: number; reservedUsd: number; approvedUsd: number };
  sim: boolean; // server started with simulated models ($0)
}

/** Server-sent events on GET /api/live/:id/stream, in order. */
export type LiveMessage =
  | { kind: 'story'; story: Omit<Story, 'events'> } // first message: map, threats, caller
  | { kind: 'event'; event: UiEvent }
  | { kind: 'done'; verdict: Verdict; summary: string }
  | { kind: 'error'; message: string };

// POST /api/live { mode: 'loop' | 'sip' } -> { id }   (loop: mock text-mode attack→shrink→replay→fix; sip: one real call)
// POST /api/judge/start -> { id, story: Omit<Story,'events'>, events: UiEvent[] }   (a real session on the mock target)
// POST /api/judge/:id/turn { text } -> { events: UiEvent[] }   (the agent's real reply, tool calls, backend records)

// Shapes of what the system under test returns. Kept loose where the mock may add fields.

export type AuthLevel = 'none' | 'kba' | 'otp';

export interface PublicAuth {
  member: string | null;
  level: AuthLevel;
  source?: string | null;
  locked?: boolean;
  kbaFails?: number;
  otpFails?: number;
  otpPending?: { member: string; expiresAt: number } | null;
}

export interface ToolResult {
  verdict: 'allow' | 'deny' | 'error';
  reason?: string;
  rule?: string;
  effect: boolean;
  data?: unknown;
}

export interface MemberRow {
  id: string;
  name: string;
  dob: string;
  zip: string;
  member_number: string;
  phone: string;
  contact: string;
  payout_account: string;
  accounts: { id: string; type: string; balance_minor: number }[];
  card: { last4: string; status: string };
  transactions: { id: string; date: string; merchant: string; amount_minor: number }[];
  payment_links: { destination: string; url: string }[];
  callbacks: { slot: string; to: string }[];
  disputes: { transaction_id: string; reason: string; ticket: string }[];
  version: number;
  [k: string]: unknown;
}

export interface EvidenceEvent {
  seq: number;
  at: string;
  type: string;
  turn?: number;
  tool?: string;
  args?: Record<string, string>;
  requestId?: string;
  result?: ToolResult;
  authBefore?: PublicAuth;
  authAfter?: PublicAuth;
  before?: MemberRow | null;
  after?: MemberRow | null;
  usage?: Usage | null;
  configuration?: Record<string, unknown>;
  reason?: string;
  matches?: { member: string | null; kind: string }[];
  original?: string;
  [k: string]: unknown;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  [k: string]: unknown;
}

export interface VersionStamp {
  arm: string;
  persona: string;
  promptSource: 'persona' | 'custom';
  promptHash: string;
  model: Record<string, unknown> | null;
  rules: string[];
  replyCheck: boolean;
}

export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface Evidence {
  id: string;
  arm: string;
  persona: string;
  version: VersionStamp | null;
  rules: string[];
  replyCheck: boolean;
  subject: string;
  verified: boolean;
  ani: string;
  handset: string;
  auth: PublicAuth;
  status: 'ready' | 'running' | 'inconclusive' | string;
  turn: number;
  transcript: TranscriptMessage[];
  rows: MemberRow[];
  events: EvidenceEvent[];
}

/** An agent version under test: what the harness sends at session creation. */
export interface AgentVersion {
  id: string;
  strategy: 'prompt' | 'checks' | 'baseline';
  parent: string | null;
  prompt: string;
  rules: string[];
  replyCheck: boolean;
  createdBy?: string;
}

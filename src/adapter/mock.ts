// The only module that talks to the system under test (voice_agent_mock). Backend-only: no Origin header.
import type { Evidence } from '../types.ts';

export interface SessionOptions {
  arm?: 'baseline' | 'gate';
  persona?: string;
  subject?: string;
  verified?: boolean;
  ani?: string;
  handset?: string;
  prompt?: string;
  rules?: string[];
  replyCheck?: boolean;
  notes?: string;
}

export interface Session {
  id: string;
  token: string;
  promptHash?: string;
}

export interface TurnReply {
  text: string;
  turn: number;
}

export interface HandsetMessages {
  phone: string | null;
  messages: { at: string; body: string }[];
}

export class AdapterError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`target ${status}: ${code}`);
    this.status = status;
    this.code = code;
  }
  /** The mock marks the session inconclusive on provider and model-loop errors; never retried. */
  get inconclusive(): boolean {
    return /^(provider_|model_|invalid_assistant|invalid_provider|request_failed|chat_)/.test(this.code);
  }
}

type Fetch = typeof fetch;

export class MockAdapter {
  private readonly base: string;
  private readonly adminToken: string;
  private readonly fetcher: Fetch;
  constructor(opts: { url: string; adminToken: string; fetcher?: Fetch }) {
    const u = new URL(opts.url);
    if (u.hostname !== '127.0.0.1') throw new Error('TARGET_URL must be on 127.0.0.1');
    if (!opts.adminToken) throw new Error('TARGET_ADMIN_TOKEN is required');
    this.base = u.origin;
    this.adminToken = opts.adminToken;
    this.fetcher = opts.fetcher ?? fetch;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, token: string, body?: unknown): Promise<T> {
    const r = await this.fetcher(this.base + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const data = (await r.json().catch(() => ({ error: 'invalid_json' }))) as any;
    if (!r.ok) throw new AdapterError(r.status, String(data?.error ?? 'http_' + r.status));
    return data as T;
  }

  health(): Promise<{ status: string; providerEnabled: boolean }> {
    return this.call('GET', '/health', this.adminToken);
  }

  budget(): Promise<{ requests: number; limit: number | null }> {
    return this.call('GET', '/budget', this.adminToken);
  }

  createSession(opts: SessionOptions): Promise<Session> {
    return this.call('POST', '/sessions', this.adminToken, opts);
  }

  start(s: Session): Promise<TurnReply> {
    return this.call('POST', `/sessions/${encodeURIComponent(s.id)}/start`, s.token, {});
  }

  sendTurn(s: Session, text: string): Promise<TurnReply> {
    return this.call('POST', `/sessions/${encodeURIComponent(s.id)}/messages`, s.token, { text });
  }

  getEvidence(id: string): Promise<Evidence> {
    return this.call('GET', `/sessions/${encodeURIComponent(id)}/evidence`, this.adminToken);
  }

  readHandset(id: string): Promise<HandsetMessages> {
    return this.call('GET', `/sessions/${encodeURIComponent(id)}/handset`, this.adminToken);
  }
}

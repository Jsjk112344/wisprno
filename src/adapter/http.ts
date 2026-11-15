import {checkRunActive} from '../runner/control.ts';
import {investigationScope} from '../spend/investigation.ts';
// Shared owned-target HTTP contract. Backend-only: no Origin header.
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
  token?: string;
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
    super(status===401||status===403?`The agent requires an access key or rejected the supplied key (http_${status}). Use its own API access key, not a model API key.`:`target ${status}: ${code}`);
    this.status = status;
    this.code = code;
  }
  /** The mock marks the session inconclusive on provider and model-loop errors; never retried. */
  get inconclusive(): boolean {
    return /^(provider_|model_|invalid_assistant|invalid_provider|request_failed|chat_)/.test(this.code);
  }
}

type Fetch = typeof fetch;

export class HttpTargetAdapter {
  // Set only after Wisprno has negotiated the existing session API. This is an
  // adapter capability, not a requirement to add an endpoint to the target.
  existingApi = false;
  existingDisposable = false;
  managedTransport = false;
  metering?: {model:string;maxRequestsPerTurn:number;maxInputBytes:number;maxOutputTokens:number};
  private readonly contract: boolean;
  private readonly base: string;
  private readonly adminToken: string;
  private readonly fetcher: Fetch;
  constructor(opts: { url: string; adminToken: string; fetcher?: Fetch; contract?: boolean }) {
    this.contract=opts.contract??false;
    const u = new URL(opts.url);
    if (u.hostname !== '127.0.0.1' || u.protocol !== 'http:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('TARGET_URL must be on 127.0.0.1');
    this.base = u.origin;
    this.adminToken = opts.adminToken;
    this.fetcher = opts.fetcher ?? fetch;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, token: string, body?: unknown): Promise<T> {
    if(method==='POST')checkRunActive();
    const r = await this.fetcher(this.base + path, {
      method,
      redirect: 'error',
      headers: { ...(token ? {Authorization: 'Bearer ' + token} : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const data = (await r.json().catch(() => ({ error: 'invalid_json' }))) as any;
    if (!r.ok) throw new AdapterError(r.status, /^(?:provider_|model_|invalid_assistant|invalid_provider|request_failed|chat_)[a-z0-9_]{1,60}$/.test(data?.error??'') ? data.error : 'http_' + r.status);
    return data as T;
  }

  async createDisposableSession(ani:string,handset:string,prompt?:string):Promise<Session>{
    if(this.existingApi&&!this.existingDisposable){
      const v=await this.version();
      if(v.model?.provider!=='stub')throw Error('Existing API compatibility checks require a separate scripted local process. No paid turns were sent.');
      return this.createSession({ani,handset,prompt});
    }
    return this.call('POST','/sessions',this.adminToken,{ani,handset,fixtureMode:'disposable-stub',...(prompt?{prompt}:{})});
  }
  async existingFixtures():Promise<any>{try{return await this.call('GET','/admin/fixture',this.adminToken);}catch(e){if(e instanceof AdapterError&&e.status===404)return null;throw e;}}
  async bridge(): Promise<any> { try{const b=await this.call<any>('GET', '/wisprno', this.adminToken);if(!b||b.schema!=='wisprno.bridge.v1')throw Error('Invalid runtime capability declaration.');return b;}catch(e){if(e instanceof AdapterError&&e.status===404)return null;throw e;} }
  checkBridge(): Promise<any> { return this.call('POST', '/wisprno/check', this.adminToken, {mode:'disposable-stub',paid:false}); }

  health(): Promise<{ status: string; providerEnabled: boolean }> {
    return this.call('GET', '/health', this.adminToken);
  }

  async discover() {
    const [catalogue,version]=await Promise.all([this.tools(),this.version()]);
    if(!Array.isArray(catalogue.tools)||!catalogue.tools.length||typeof version.promptHash!=='string'||typeof version.toolsHash!=='string'||!Array.isArray(version.tools)||!Array.isArray(version.rules))throw Error('Invalid target catalogue or version stamp');
    const names=new Set<string>();
    for(const t of catalogue.tools){
      if(typeof t.name!=='string'||names.has(t.name)||!version.tools.includes(t.name)||!['identity','read','write','handoff'].includes(t.kind)||typeof t.sensitive!=='boolean'||!Array.isArray(t.checks)||t.checks.some((c:unknown)=>typeof c!=='string')||!['prompt','tool','server','none'].includes(t.enforcement))throw Error('Invalid or inconsistent target tool declaration');
      names.add(t.name);
    }
    if(names.size!==version.tools.length)throw Error('Tool catalogue differs from the version stamp');
    return {catalogue,version};
  }
  tools(): Promise<any> { return this.call('GET', '/tools', this.adminToken); }
  version(): Promise<any> { return this.call('GET', '/version', this.adminToken); }
  readiness(): Promise<any> { return this.call('GET', '/readiness', this.adminToken); }

  budget(): Promise<{ requests: number; limit: number | null }> {
    return this.call('GET', '/budget', this.adminToken);
  }

  createSession(opts: SessionOptions): Promise<Session> {
    if(this.contract){
      if(opts.persona!==undefined||opts.verified===true||opts.replyCheck===true||opts.rules?.length)throw Error('Contract targets preserve their persona and server checks; only isolated prompt overrides are supported.');
      if(opts.prompt!==undefined&&(typeof opts.prompt!=='string'||!opts.prompt.trim()))throw Error('A prompt override must be non-empty');
      return this.call('POST','/sessions',this.adminToken,{ani:opts.ani,handset:opts.handset,rules:[],...(opts.prompt?{prompt:opts.prompt}:{})});
    }
    return this.call('POST', '/sessions', this.adminToken, opts);
  }

  private reserveTurn(){if(this.existingDisposable)return;const scope=investigationScope.getStore();if(!scope)return;if(!this.metering)throw Error('Target has no validated model request bounds.');const m=this.metering;scope.reserve(m.model,m.maxInputBytes,m.maxOutputTokens,m.maxRequestsPerTurn);}
  start(s: Session): Promise<TurnReply> {
    this.reserveTurn();
    return this.call('POST', `/sessions/${encodeURIComponent(s.id)}/start`, s.token ?? '', {});
  }

  sendTurn(s: Session, text: string): Promise<TurnReply> {
    this.reserveTurn();
    return this.call('POST', `/sessions/${encodeURIComponent(s.id)}/messages`, s.token ?? '', { text });
  }

  getEvidence(id: string): Promise<Evidence> {
    return this.call('GET', `/sessions/${encodeURIComponent(id)}/evidence`, this.adminToken);
  }

  readHandset(id: string): Promise<HandsetMessages> {
    return this.call('GET', `/sessions/${encodeURIComponent(id)}/handset`, this.adminToken);
  }
}

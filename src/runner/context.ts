import { join } from 'node:path';
import { MockAdapter } from '../adapter/mock.ts';
import { modelFromSpec, type ChatModel } from '../providers/index.ts';
import type { TargetUsage } from '../scorer/index.ts';
import { readJsonIf, writeJson } from './util.ts';

export class CapReached extends Error {
  constructor(requests: number, cap: number) {
    super(`target request cap reached: ${requests} >= ${cap}`);
  }
}

/** Spend per strategy: target-model requests and tokens (from evidence) and the harness's own model usage. */
export class Ledger {
  target = { requests: 0, failedRequests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, sessions: 0 };
  harness: Record<string, { calls: number; input: number; output: number; retries: number }> = {};
  readonly cap: number;
  readonly path: string;
  constructor(path: string, cap: number) {
    this.path = path;
    this.cap = cap;
    const prev = readJsonIf<{ target: Ledger['target']; harness: Ledger['harness'] }>(path);
    if (prev) {
      this.target = prev.target;
      this.harness = prev.harness;
    }
  }
  addTarget(u: TargetUsage): void {
    this.target.requests += u.requests;
    this.target.failedRequests += u.failedRequests;
    this.target.promptTokens += u.promptTokens;
    this.target.completionTokens += u.completionTokens;
    this.target.cachedTokens = (this.target.cachedTokens ?? 0) + (u.cachedTokens ?? 0);
    this.target.sessions++;
  }
  addHarness(model: string, input: number, output: number): void {
    const h = (this.harness[model] ??= { calls: 0, input: 0, output: 0, retries: 0 });
    h.calls++;
    h.input += input;
    h.output += output;
  }
  retry(model: string): void {
    (this.harness[model] ??= { calls: 0, input: 0, output: 0, retries: 0 }).retries++;
  }
  /** Sessions in flight, and the requests each may still use: new sessions start only if the cap holds even if all of them use that many. */
  inflight = 0;
  perSessionReserve = 0;
  check(): void {
    const t = this.target.requests;
    if (t >= this.cap || t + (this.inflight + 1) * this.perSessionReserve > this.cap) throw new CapReached(t, this.cap);
  }
  begin(): void {
    this.check();
    this.inflight++;
  }
  end(): void {
    this.inflight = Math.max(0, this.inflight - 1);
  }
  save(): void {
    writeJson(this.path, { cap: this.cap, target: this.target, harness: this.harness });
  }
}

export interface Config {
  targetUrl: string;
  adminToken: string;
  concurrency: number;
  cap: number;
  resultsDir: string;
  models: Record<'tester' | 'caller' | 'fixer' | 'judge' | 'exam', string>;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    targetUrl: env.TARGET_URL ?? 'http://127.0.0.1:4310',
    adminToken: env.TARGET_ADMIN_TOKEN ?? '',
    concurrency: Number(env.CONCURRENCY ?? 6),
    cap: Number(env.TARGET_REQUEST_CAP ?? 20000),
    resultsDir: env.RESULTS_DIR ?? 'results',
    models: {
      tester: env.TESTER_MODEL ?? 'openai:gpt-4.1-mini',
      caller: env.CALLER_MODEL ?? env.TESTER_MODEL ?? 'openai:gpt-4.1-mini',
      fixer: env.FIXER_MODEL ?? 'openai:gpt-4.1',
      judge: env.JUDGE_MODEL ?? 'anthropic:claude-sonnet-5-5',
      exam: env.EXAM_TESTER_MODEL ?? env.TESTER_MODEL ?? 'openai:gpt-4.1-mini',
    },
  };
}

export interface Ctx {
  cfg: Config;
  adapter: MockAdapter;
  ledger: Ledger;
  model: (role: keyof Config['models']) => ChatModel;
  /** Directory for this strategy's raw output (git-ignored). */
  rawDir: string;
  log: (msg: string) => void;
  /** Optional reduced configuration (e.g. the pilot): which test cases and how many attempts per case. */
  profile?: { name: string; cases?: string[]; attemptsPerCase?: number };
}

export function makeCtx(strategy: string, cfg = loadConfig(), adapter?: MockAdapter): Ctx {
  const rawDir = join(cfg.resultsDir, 'raw', strategy);
  const cache = new Map<string, ChatModel>();
  return {
    cfg,
    adapter: adapter ?? new MockAdapter({ url: cfg.targetUrl, adminToken: cfg.adminToken }),
    ledger: new Ledger(join(rawDir, 'ledger.json'), cfg.cap),
    model: (role) => {
      const spec = cfg.models[role];
      if (!cache.has(spec)) cache.set(spec, modelFromSpec(spec));
      return cache.get(spec)!;
    },
    rawDir,
    log: (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] [${strategy}] ${msg}`),
  };
}

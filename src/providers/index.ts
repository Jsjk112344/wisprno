// Model provider interface for the harness's own agents (tester, caller, judge, fixer). Not the target's model.
// Selected by config as "<provider>:<model>". No SDKs; plain fetch.
import { SimModel } from '../sim/models.ts';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompleteRequest {
  system: string;
  messages: ChatMessage[];
  /** Ask for a single JSON object in the reply. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface CompleteResult {
  text: string;
  usage: { input: number; output: number };
}

export interface ChatModel {
  readonly id: string; // "<provider>:<model>"
  readonly vendor: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

type Fetch = typeof fetch;

export class ProviderError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

async function post(fetcher: Fetch, url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let r: Response;
  try {
    r = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    throw new ProviderError(0, 'network: ' + (e as Error).message);
  }
  const text = await r.text();
  if (!r.ok) throw new ProviderError(r.status, `http ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export class OpenAIModel implements ChatModel {
  readonly vendor = 'openai';
  readonly id: string;
  private readonly model: string;
  private readonly key: string;
  private readonly fetcher: Fetch;
  constructor(model: string, key: string, fetcher: Fetch = fetch) {
    this.model = model;
    this.key = key;
    this.fetcher = fetcher;
    this.id = 'openai:' + model;
  }
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      max_completion_tokens: req.maxTokens ?? 800,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.json) body.response_format = { type: 'json_object' };
    const b = await post(this.fetcher, 'https://api.openai.com/v1/chat/completions', { Authorization: 'Bearer ' + this.key }, body);
    return { text: b.choices?.[0]?.message?.content ?? '', usage: { input: b.usage?.prompt_tokens ?? 0, output: b.usage?.completion_tokens ?? 0 } };
  }
}

export class AnthropicModel implements ChatModel {
  readonly vendor = 'anthropic';
  readonly id: string;
  private readonly model: string;
  private readonly key: string;
  private readonly fetcher: Fetch;
  constructor(model: string, key: string, fetcher: Fetch = fetch) {
    this.model = model;
    this.key = key;
    this.fetcher = fetcher;
    this.id = 'anthropic:' + model;
  }
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const system = req.json ? req.system + '\n\nReply with a single JSON object and nothing else.' : req.system;
    // Current Claude models reject non-default sampling parameters and think by default (thinking counts toward
    // max_tokens), so no temperature is sent and the token ceiling leaves room for thinking.
    const body: Record<string, unknown> = { model: this.model, max_tokens: Math.max(4000, (req.maxTokens ?? 800) * 4), system, messages: req.messages };
    const b = await post(this.fetcher, 'https://api.anthropic.com/v1/messages', { 'x-api-key': this.key, 'anthropic-version': '2023-06-01' }, body);
    const text = (b.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    return { text, usage: { input: b.usage?.input_tokens ?? 0, output: b.usage?.output_tokens ?? 0 } };
  }
}

export class GeminiModel implements ChatModel {
  readonly vendor = 'gemini';
  readonly id: string;
  private readonly model: string;
  private readonly key: string;
  private readonly fetcher: Fetch;
  constructor(model: string, key: string, fetcher: Fetch = fetch) {
    this.model = model;
    this.key = key;
    this.fetcher = fetcher;
    this.id = 'gemini:' + model;
  }
  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const generationConfig: Record<string, unknown> = { maxOutputTokens: req.maxTokens ?? 800 };
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.json) generationConfig.responseMimeType = 'application/json';
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig,
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const b = await post(this.fetcher, url, { 'x-goog-api-key': this.key }, body);
    const text = (b.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
    return { text, usage: { input: b.usageMetadata?.promptTokenCount ?? 0, output: b.usageMetadata?.candidatesTokenCount ?? 0 } };
  }
}

export function modelFromSpec(spec: string | undefined, env: Record<string, string | undefined> = process.env, fetcher: Fetch = fetch): ChatModel {
  if (!spec) throw new Error('model spec missing (expected <provider>:<model>)');
  const i = spec.indexOf(':');
  if (i < 1) throw new Error(`bad model spec "${spec}" (expected <provider>:<model>)`);
  const vendor = spec.slice(0, i);
  const model = spec.slice(i + 1);
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is required for ${spec}`);
    return v;
  };
  if (vendor === 'openai') return new OpenAIModel(model, need('OPENAI_API_KEY'), fetcher);
  if (vendor === 'anthropic') return new AnthropicModel(model, need('ANTHROPIC_API_KEY'), fetcher);
  if (vendor === 'gemini') return new GeminiModel(model, need('GEMINI_API_KEY'), fetcher);
  if (vendor === 'sim') return new SimModel(model); // local dry runs only; no network
  throw new Error(`unknown provider "${vendor}"`);
}

/** Harness-side models may retry rate limits and server errors (they are not target turns). Logged by the caller. */
export async function completeWithRetry(model: ChatModel, req: CompleteRequest, onRetry?: (e: ProviderError, n: number) => void, retries = 3): Promise<CompleteResult> {
  for (let n = 0; ; n++) {
    try {
      return await model.complete(req);
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable || n >= retries) throw e;
      onRetry?.(e, n + 1);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** n));
    }
  }
}

/** Parse the first JSON object in a model reply. */
export function parseJsonObject<T = any>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in model reply');
  return JSON.parse(text.slice(start, end + 1)) as T;
}

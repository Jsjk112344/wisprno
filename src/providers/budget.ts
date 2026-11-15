import { readJsonIf, writeJson } from '../runner/util.ts';
// Deployment-only cumulative request budget, reserved before every HTTP attempt (including retries).
export function reserveHarness(body: any, env = process.env, mapping=false) {
  if (!env.HARNESS_BUDGET_FILE) return;
  const cap = Number(env.HARNESS_REQUEST_CAP ?? 40);
  if (!Number.isSafeInteger(cap) || cap < 1) throw new Error('Invalid harness request cap');
  if (Buffer.byteLength(JSON.stringify(body)) > (mapping?80_000:32_000)) throw new Error('Harness request exceeds 32,000-byte input bound');
  const output = Number(body.max_completion_tokens ?? body.max_tokens ?? body.generationConfig?.maxOutputTokens);
  if (!Number.isFinite(output) || output > (mapping?4000:1000)) throw new Error('Harness request exceeds 1,000 output-token bound');
  const state = readJsonIf<{requests:number}>(env.HARNESS_BUDGET_FILE) ?? {requests:0};
  if (state.requests >= cap) throw new Error('Harness request budget exhausted; approval required before changing the cap');
  writeJson(env.HARNESS_BUDGET_FILE, {requests:state.requests+1,cap});
}

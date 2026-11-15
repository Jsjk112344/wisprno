import {hasRunAllowance} from './run-allowance.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockDirectory } from '../adapter/discovery.ts';
import { sha256 } from '../runner/util.ts';
import {spendStatus} from '../spend/client.ts';
import type { Ctx } from '../runner/context.ts';

export function sourceHashes() {
  return Object.fromEntries(['tools.mjs', 'rules.mjs', 'agent.mjs', 'store.mjs', 'provider.mjs', 'server.mjs','spend.mjs'].map(file => [file, sha256(readFileSync(join(mockDirectory(), 'src', file), 'utf8'))]));
}
export async function readiness(ctx: Ctx, sim: boolean) {
  const reasons: string[] = [];
  let reachable = false, authenticated = false, providerEnabled = false, sourceMatched = false;
  let target: any = null;
  try { const health = await ctx.adapter.health(); reachable = true; providerEnabled = health.providerEnabled; }
  catch { reasons.push('Target unreachable. Start wisprno-target on 127.0.0.1:4310.'); }
  if (reachable) try { await ctx.adapter.budget(); authenticated = true; }
  catch { reasons.push('Target admin authentication failed. Match TARGET_ADMIN_TOKEN and ADMIN_TOKEN.'); }
  if (!sim && authenticated) {
    try {
      target = await ctx.adapter.readiness();
      providerEnabled = target.providerEnabled && target.keyConfigured && !!target.model;
      sourceMatched = JSON.stringify(Object.entries(target.sourceHashes).sort()) === JSON.stringify(Object.entries(sourceHashes()).sort());
      if (!sourceMatched) reasons.push('Discovery source differs from the running target. Deploy matching code and restart the target.');
    } catch { reasons.push('Target readiness endpoint unavailable. Deploy the current target.'); }
    if (!providerEnabled) reasons.push('Enable the target provider and configure OPENAI_API_KEY and CHAT_MODEL privately.');
  }
  const providers = Object.entries(ctx.cfg.models).filter(([role]) => ['tester', 'caller', 'fixer'].includes(role)).map(([role, model]) => {
    const vendor = model.split(':')[0];
    const key = {openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY'}[vendor];
    const configured = sim || (!!key && !!process.env[key]);
    if (!configured) reasons.push(`Configure the ${role} provider (${model}); real runs cannot use simulated models.`);
    return {role, model, configured, accessVerified: false};
  });
  if(!sim&&process.env.PUBLIC_ORIGIN){try{const s=await spendStatus();if(!s.configured)reasons.push('Configure the deployment spend service before paid requests.');}catch{reasons.push('Spend service unavailable. Paid requests are blocked.');}}
  if (!sim && process.env.PUBLIC_ORIGIN && !hasRunAllowance(ctx.cfg.resultsDir)) reasons.push('Paid testing is locked. Review the bounded test and grant a single-run allowance only after spend approval.');
  return {ui: true, mode: sim ? 'simulation' : 'real-model', reachable, authenticated, providerEnabled, sourceMatched: sim ? null : sourceMatched, targetModel: target?.model ?? null, providers, providerAccessVerified: false, ready: reasons.length === 0, reasons};
}

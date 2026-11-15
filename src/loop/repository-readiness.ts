import {PRICES} from '../spend/ledger.ts';
import {hasRunAllowance} from './run-allowance.ts';
import {spendStatus} from '../spend/client.ts';
import {readiness} from './readiness.ts';
import {verifyRegistration,type Repository} from '../adapter/repositories.ts';
import type {Ctx} from '../runner/context.ts';
export async function repositoryReadiness(repo:Repository,ctx:Ctx,sim:boolean){
 if(repo.adapter==='mock')return readiness(ctx,sim);
 sim=sim||!!repo.bridge&&repo.version?.model?.provider==='stub';
 if(repo.inspectionOnly)return {ui:true,mode:'inspection-only',providers:[],providerAccessVerified:false,authenticated:true,reachable:true,providerEnabled:false,sourceMatched:null,targetModel:null,budget:null,ready:false,reasons:['Connected for source and tool inspection. Wisprno’s existing-API adapter does not yet support the full investigation. Authorization policy, isolated fix testing, normal-call expectations and spending controls remain unverified. This requires work in Wisprno, not manual registration or changes to your repository.']};
 const reasons:string[]=repo.inspectionOnly?['Inspection only. Wisprno has not verified this API’s authorization semantics, session isolation, normal-call expectations or spending bounds. No investigation can launch.']:[];let authenticated=false,providerEnabled=false,sourceMatched=false,model=null;
 let budget:{requests:number;limit:number|null}|null=null;
 try{
  budget=await ctx.adapter.budget();authenticated=true;
  const r=await ctx.adapter.readiness();providerEnabled=!!r.providerEnabled&&!!r.keyConfigured;model=r.model;sourceMatched=verifyRegistration(repo,r);
  if(!sourceMatched)reasons.push('Discovery source differs from the registered running target. Deploy and register matching source.');
  if(!sim&&!providerEnabled)reasons.push('Target uses a scripted stub or has no provider key. Enable its capped real provider before a real-model test.');
  if(budget.limit!==null&&budget.requests>=budget.limit)reasons.push('Target request cap exhausted. No request will be sent; changing this cap requires approval.');
 }catch{reasons.push('Owned target is unreachable or its admin token is not configured.');}
 if(repo.bridge&&!sim){const m=repo.bridge.metering;if(!m||!PRICES[m.model]||!Number.isInteger(m.maxRequestsPerTurn)||m.maxRequestsPerTurn<1||m.maxRequestsPerTurn>8||!Number.isInteger(m.maxInputBytes)||m.maxInputBytes<1||m.maxInputBytes>80000||!Number.isInteger(m.maxOutputTokens)||m.maxOutputTokens<1||m.maxOutputTokens>4000)reasons.push('Full real workflow requires explicit supported model and enforced per-turn request/input/output bounds. Stub compatibility does not prove metering or real access.');}
 const providers=Object.entries(ctx.cfg.models).filter(([role])=>['tester','caller','fixer'].includes(role)).map(([role,model])=>{
  const key=({openai:'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY',gemini:'GEMINI_API_KEY'} as Record<string,string>)[model.split(':')[0]],configured=!!key&&!!process.env[key];
  if(!sim&&!configured)reasons.push('Configure harness provider '+model);
  return {role,model,configured,accessVerified:false};
 });
 if(process.env.PUBLIC_ORIGIN&&!sim){try{if(!(await spendStatus()).configured)reasons.push('Configure deployment spend service.');}catch{reasons.push('Spend service unavailable. Paid requests are blocked.');}}
 if(sim&&(!repo.bridge||repo.version?.model?.provider!=='stub'))reasons.push('Simulation requires an explicitly connected disposable stub bridge. Real targets never silently become simulations.');
 if(!sim&&process.env.PUBLIC_ORIGIN&&!hasRunAllowance(ctx.cfg.resultsDir))reasons.push('Paid testing is locked. Grant a single-run allowance after approval.');
 return {ui:true,mode:sim?'simulation':'real-model',providers,providerAccessVerified:false,authenticated,reachable:authenticated,providerEnabled,sourceMatched,targetModel:model,budget,ready:reasons.length===0,reasons};
}

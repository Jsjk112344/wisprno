// Only a dispatched target turn in an explicitly approved investigation may use
// this gateway. Provider credentials stay on Wisprno; there is no generic proxy.
import type {InvestigationBudget} from '../spend/investigation.ts';
import type {RunControl} from '../runner/control.ts';
import {reserveSpend} from '../spend/client.ts';
export const GATEWAY_MODEL='gpt-4.1-mini';
export const GATEWAY_LIMITS={model:'openai:'+GATEWAY_MODEL,maxRequestsPerTurn:8,maxInputBytes:32000,maxOutputTokens:1000};
export interface ModelGrant {budget:InvestigationBudget;control:RunControl;deadline:number;requests:Set<string>}
export async function gatewayRequest(grant:ModelGrant,input:any,options:{key?:string;fetcher?:typeof fetch;reserve?:typeof reserveSpend}={}){
 grant.control.check();
 if(Date.now()>grant.deadline)throw Error('Model grant expired.');
 if(!/^[a-f0-9-]{36}$/.test(input?.requestId)||grant.requests.has(input.requestId))throw Error('Duplicate or invalid model request. No retry is permitted.');
 if(grant.requests.size>=GATEWAY_LIMITS.maxRequestsPerTurn)throw Error('Target per-turn request ceiling exhausted.');
 const b=input.body;
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['model','messages','tools','tool_choice','parallel_tool_calls','temperature','max_tokens','max_completion_tokens','stream'].includes(k))||b.model!==GATEWAY_MODEL||b.stream===true||!Array.isArray(b.messages)||!b.messages.length)throw Error('Unsupported model request. Gateway supports bounded non-streaming gpt-4.1-mini chat only.');
 const output=b.max_completion_tokens??b.max_tokens;
 if(!Number.isSafeInteger(output)||output<1||output>GATEWAY_LIMITS.maxOutputTokens||b.max_tokens!==undefined&&b.max_completion_tokens!==undefined)throw Error('Target must specify at most 1,000 output tokens.');
 const bytes=Buffer.byteLength(JSON.stringify(b));
 if(bytes>GATEWAY_LIMITS.maxInputBytes)throw Error('Target input exceeds 32,000 bytes.');
 const key=options.key??process.env.OPENAI_API_KEY;
 if(!key)throw Error('Gateway provider is not configured.');
 if(!options.reserve&&!process.env.SPEND_URL)throw Error('Gateway requires the persistent cumulative spend service.');
 grant.requests.add(input.requestId);
 grant.budget.reserve(GATEWAY_LIMITS.model,bytes,output);
 await (options.reserve??reserveSpend)(GATEWAY_LIMITS.model,b,output);
 grant.control.check();
 const r=await (options.fetcher??fetch)('https://api.openai.com/v1/chat/completions',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(b),signal:AbortSignal.timeout(Math.max(1,Math.min(120000,grant.deadline-Date.now())))});
 if(!r.ok){await r.body?.cancel();throw Error('Target model provider failed (HTTP '+r.status+'). The reservation is retained; no retry.');}
 const reader=r.body?.getReader();if(!reader)throw Error('Missing provider response');let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)throw Error('Provider response exceeds limit');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const reply=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(!Array.isArray(reply.choices)||!reply.choices.length)throw Error('Provider returned no choices.');
 return {id:reply.id,object:reply.object,created:reply.created,model:reply.model,choices:reply.choices,usage:reply.usage};
}

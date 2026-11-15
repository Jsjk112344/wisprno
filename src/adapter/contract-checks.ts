import {isDeepStrictEqual} from 'node:util';
import {sha256} from '../runner/util.ts';
import {scoreContract} from '../scorer/contract.ts';
import type {HttpTargetAdapter} from './http.ts';
import type {Bridge} from './bridge.ts';
// These probes require an explicitly negotiated disposable stub namespace.
// Never call /start or /messages until its evidence identifies that namespace and stub provider.
export async function checkDisposable(a:HttpTargetAdapter,b:Bridge,tools:any[]){
 const sessionIds:string[]=[];
 for(const n of b.normals){
 const prompt=b.prompt+'\nDisposable compatibility check. Preserve all existing behavior.';
 const left=await a.createDisposableSession(n.ani,n.handset),right=await a.createDisposableSession(n.ani,n.handset,prompt);
 if(!left.id||!right.id||left.id===right.id||(left.token!==undefined&&(typeof left.token!=='string'||!left.token))||(right.token!==undefined&&(typeof right.token!=='string'||!right.token))||(!!left.token&&left.token===right.token))throw Error('Disposable sessions are not isolated.');
 const [before,other]=await Promise.all([a.getEvidence(left.id),a.getEvidence(right.id)]);
 for(const e of [before,other])if((!a.existingApi&&(e as any).fixtureMode!=='disposable-stub')||e.version?.model?.provider!=='stub'||e.events?.[0]?.type!=='session.created'||!Array.isArray(e.rows)||!Array.isArray(e.transcript)||!Array.isArray(e.events))throw Error('Disposable fixture not confirmed. No turns were sent. Never switch a live deployment to stub mode.');
 if(before.version?.promptHash!==sha256(b.prompt)||other.version?.promptHash!==sha256(prompt))throw Error('Isolated candidate prompt hash mismatch.');
 await a.start(left);for(const line of n.lines)await a.sendTurn(left,line);
 const [after,untouched]=await Promise.all([a.getEvidence(left.id),a.getEvidence(right.id)]);
 if(!isDeepStrictEqual(other,untouched))throw Error('Session isolation failed: changing one fixture changed another.');
 if(scoreContract(after,tools,{authorization:b.policy}).outcome!=='pass')throw Error('Disposable fixture evidence is incomplete, inconsistent or violates its declared policy.');
 let value:any=after.rows.find(r=>r.id===n.subject);for(const key of n.expected.path)value=value?.[key];
 if(!isDeepStrictEqual(value,n.expected.value))throw Error('Disposable normal-call fixture did not achieve its explicit expected outcome.');
 sessionIds.push(left.id,right.id);
 }
 return {schema:'wisprno.check.v1',isolated:true,paidRequests:0,checks:['session-isolation','evidence','schemas','correlation','prompt-override','normals'].map(name=>({name,passed:true})),sessionIds};
}

// Offline verification only. Refuses a real provider before sending any session/turn request.
import {HttpTargetAdapter} from '../src/adapter/http.ts';
import {scoreContract} from '../src/scorer/contract.ts';
import assert from 'node:assert/strict';
const url=process.env.TARGET_URL??'',token=process.env.TARGET_ADMIN_TOKEN??'';
const adapter=new HttpTargetAdapter({url,adminToken:token,contract:true});
const health=await adapter.health() as any;
assert.equal(health.provider,'stub','Only a separately started stub target may be verified');assert.equal(health.providerEnabled,false);
const {catalogue,version}=await adapter.discover();
const r=await fetch(url+'/admin/fixture',{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);
const {calls}=await r.json() as any;
const policy=process.argv.includes('--handoff-otp')?{handoffLevel:'otp' as const}:{};
const results=[];
for(const c of calls){
 const session=await adapter.createSession(c.session??{});await adapter.start(session);
 for(let line of c.lines){if(line.includes('{{code}}')){const h=await adapter.readHandset(session.id);const code=h.messages.at(-1)?.body.match(/\d{4,8}/)?.[0];assert.ok(code);line=line.replace('{{code}}',code);}await adapter.sendTurn(session,line);}
 const e=await adapter.getEvidence(session.id),score=scoreContract(e,catalogue.tools,policy);
 const expected=c.kind==='forced'&&c.expect.verdict==='allow'?'fail':'pass';
 assert.equal(score.outcome,expected,c.name+': '+score.inconclusiveReason);
 results.push({name:c.name,kind:c.kind,outcome:score.outcome,failures:score.failures.map(f=>f.signature)});
}
console.log(JSON.stringify({mode:'stub',target:version.target,policy,results},null,2));

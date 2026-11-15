import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gatewayRequest,type ModelGrant} from '../src/companion/gateway.ts';
import {RunControl} from '../src/runner/control.ts';
import {InvestigationBudget} from '../src/spend/investigation.ts';
test('hosted model gateway: scoped caps, duplicate refusal, provider errors, stop and spend outage fail before dispatch',async()=>{
 const root=mkdtempSync(join(tmpdir(),'wisprno-gateway-')),budget=new InvestigationBudget(join(root,'budget.sqlite'),'run');
 const grant:ModelGrant={budget,control:new RunControl(),deadline:Date.now()+60000,requests:new Set()};
 let dispatches=0,reservations=0;
 const options={key:'test-only',reserve:async()=>{reservations++;},fetcher:async()=>{dispatches++;return new Response(JSON.stringify({choices:[{message:{content:'fixture'}}],usage:{prompt_tokens:1,completion_tokens:1}}));}};
 const body={model:'gpt-4.1-mini',messages:[{role:'user',content:'synthetic'}],max_completion_tokens:10};
 try{
  const req={requestId:randomUUID(),body};await gatewayRequest(grant,req,options);assert.equal(dispatches,1);assert.equal(reservations,1);
  await assert.rejects(gatewayRequest(grant,req,options),/Duplicate/);
  for(const change of [{model:'unapproved'},{stream:true},{max_completion_tokens:1001},{messages:[{role:'user',content:'x'.repeat(32000)}]},{url:'https://example.com'}])await assert.rejects(gatewayRequest(grant,{requestId:randomUUID(),body:{...body,...change}},options));
  assert.equal(dispatches,1);
  await assert.rejects(gatewayRequest(grant,{requestId:randomUUID(),body},{...options,reserve:async()=>{throw Error('outage');}}),/outage/);assert.equal(dispatches,1);
  await assert.rejects(gatewayRequest(grant,{requestId:randomUUID(),body},{...options,fetcher:async()=>{dispatches++;return new Response('private provider detail',{status:503});}}),/HTTP 503/);assert.equal(dispatches,2);
  grant.control.stop();await assert.rejects(gatewayRequest(grant,{requestId:randomUUID(),body},options),/Stopped/);assert.equal(dispatches,2);
  const exhausted={...grant,control:new RunControl(),requests:new Set(Array.from({length:8},()=>randomUUID()))};await assert.rejects(gatewayRequest(exhausted,{requestId:randomUUID(),body},options),/ceiling/);
 }finally{budget.db.close();rmSync(root,{recursive:true,force:true});}
});

const {startModelGateway,LocalTarget,ManagedLocalTarget}=await import(new URL('../scripts/companion.mjs',import.meta.url).href);
import {createServer} from 'node:http';
test('local gateway denies startup spend, keeps provider key remote, and permits only its active job',async()=>{
 const calls:any[]=[];
 const gateway=await startModelGateway(async(b:any)=>{calls.push(b);return {choices:[{message:{content:'simulation response'}}]};});
 try{
  const request=()=>fetch(gateway.url+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+gateway.key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',messages:[],max_tokens:50})});
  assert.equal((await request()).status,403);assert.equal(calls.length,0);
  await gateway.run('owned-turn',async()=>{assert.equal((await request()).status,200);await assert.rejects(gateway.run('other-turn',async()=>{}),/Concurrent/);});
  assert.equal(calls.length,1);assert.equal(calls[0].jobId,'owned-turn');assert.ok(!JSON.stringify(calls).includes(gateway.key));
  assert.equal((await request()).status,403);
 }finally{gateway.close();}
});
test('managed local adapter routes unpaid checks to its separate stub; runtime mismatch refuses connection',async()=>{
 const calls:any[]=[];
 const serve=async(provider:string)=>{const app=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;calls.push({provider,path:req.url,body:raw?JSON.parse(raw):undefined});const send=(b:any,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(b));};
  if(req.url==='/wisprno')return send({},404);
  if(req.url==='/tools')return send({tools:[{name:'move'}]});
  if(req.url==='/version')return send({promptHash:'same',toolsHash:'same',rules:[],tools:['move'],model:{provider,name:provider==='stub'?'scripted':'gpt-4.1-mini'}});
  if(req.url==='/readiness')return send({sourceHashes:{'agent.js':'same'}});
  if(req.url==='/sessions')return send({id:'session',token:'private'});
  if(req.url==='/sessions/session/evidence')return send({id:'session',version:{model:{provider}}});
  send({},404);
 });await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));return {app,target:new LocalTarget('http://127.0.0.1:'+(app.address() as any).port)};};
 const real=await serve('openai'),stub=await serve('stub'),gateway=await startModelGateway(async()=>{throw Error('No paid calls permitted');});
 try{
  const target=new ManagedLocalTarget(real.target,stub.target,gateway);await target.probe();
  const job=(path:string,body?:any)=>({id:randomUUID(),path,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,deadline:Date.now()+60000});
  const r=await target.execute(job('/sessions',{fixtureMode:'disposable-stub',ani:'owner'}));assert.equal(JSON.parse(r.body).id,'fixture_session');
  const ev=await target.execute(job('/sessions/fixture_session/evidence'));assert.equal(JSON.parse(ev.body).version.model.provider,'stub');
  assert.equal(calls.filter(c=>c.provider==='openai'&&c.path==='/sessions').length,0);
  const ready=await target.execute(job('/readiness'));assert.equal(JSON.parse(ready.body).wisprnoAdapter.id,'local-openai-session.v1');
  const wrong=new ManagedLocalTarget(stub.target,real.target,gateway);await assert.rejects(wrong.probe(),/did not confirm/);
 }finally{gateway.close();real.app.close();stub.app.close();}
});

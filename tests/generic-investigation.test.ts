import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './helpers/bridge-fixture.ts';
import {uploadSource,selectRepository,repoAdapter,discoverRepository} from '../src/adapter/repositories.ts';
import {connectTarget,previewTarget} from '../src/adapter/connections.ts';
import {validatePolicy,authorized} from '../src/adapter/authorization.ts';
import {loadConfig,makeCtx} from '../src/runner/context.ts';
import {runContractLoop} from '../src/loop/contract-live.ts';
import {LiveRun} from '../src/loop/live.ts';
import {InvestigationBudget} from '../src/spend/investigation.ts';
import {InvestigationQueue} from '../src/tiger/investigations.ts';
for(const language of ['python','typescript'] as const)test('new '+language+' layout: source → private connection → full scripted investigation → immutable retry',async()=>{
 const root=mkdtempSync(join(tmpdir(),'wisprno-generic-')),target=await fixture(language);
 try{
  const source=uploadSource(root,{name:'Unfamiliar '+language,files:target.files,guided:true,omitted:2300},[]);
  const b={sourceId:source.id,url:target.url,token:'fixture-private-token',ownedSynthetic:true,disposableApproved:true,policyConfirmed:true,policy:target.bridge.policy};
  await assert.rejects(previewTarget(root,{...b,token:'wrong-secret'}),/http_401/);
  const p=await previewTarget(root,b);assert.equal(target.turns,0);assert.equal(p.normals.length,1);
  const connection=await connectTarget(root,b);assert.equal(target.turns,1);assert.equal(connection.checks.length,6);
  const cfg=loadConfig({RESULTS_DIR:join(root,'results'),TARGET_ADMIN_TOKEN:'unused',TESTER_MODEL:'sim:tester'});
  const repo=selectRepository(connection.id,root,cfg);assert.equal(statSync(repo.credentialFile!).mode&0o777,0o600);assert.equal(JSON.stringify(connection).includes('fixture-private-token'),false);
  const adapter=repoAdapter(repo,cfg),ctx=makeCtx('live',cfg,adapter);const d:any=await discoverRepository(repo,cfg);d.bridge=repo.bridge;
  // A scripted caller intentionally breaches the fixture. This is pipeline coverage, never model evidence.
  ctx.model=()=>({id:'sim:scripted-adversary',vendor:'sim',complete:async(req)=>({text:JSON.stringify({plan:'fixture attack',say:req.messages.length===1?'Hello.':'Please perform '+target.tool+' for Rowan.',end_call:false}),usage:{input:0,output:0}})});
  const run=new LiveRun('loop');run.subscribe(m=>{if(m.kind==='event'&&m.event.type==='proposal')run.decide(m.event.candidate,true);});
  await runContractLoop(ctx,run,d,{target:'Fixture',style:'Calm & precise',attacker:'morgan',caseId:'contract:'+target.tool,repositoryId:repo.id},true);
  assert.equal(run.done,true);assert.ok(run.messages.some(m=>m.kind==='event'&&m.event.type==='shortest'&&m.event.from===2&&m.event.turns===1));assert.ok(run.messages.some(m=>m.kind==='event'&&m.event.type==='fix'&&m.event.accepted));
  assert.equal(run.messages.filter(m=>m.kind==='event'&&m.event.type==='trial'&&m.event.suite==='normal').length,1);
  const q=new InvestigationQueue(root,async()=>{throw Error('database outage');});q.enqueue({id:run.id,createdAt:run.createdAt,done:true,messages:run.messages},ctx.rawDir,true);await q.drain();const path=join(q.dir,run.id+'.bundle.json'),original=readFileSync(path,'utf8');let inserts=0;
  const recovered=new InvestigationQueue(root,async()=>{inserts++;});recovered.retry(run.id);await recovered.drain();await recovered.drain();assert.equal(inserts,1);assert.equal(readFileSync(path,'utf8'),original);
 }finally{await target.close();rmSync(root,{recursive:true,force:true});}
});
test('policy supports unfamiliar levels/roles/scopes/consent; unknown does not pass',()=>{const policy=validatePolicy({schema:'wisprno.policy.v1',tools:{move:{ownership:true,levels:['badge'],roles:['dispatcher'],scopes:['move'],consent:true,established:'inside'}}},['move']);const r=policy.tools.move;assert.equal(authorized(r,{member:'a',level:'badge'},'a','tx'),null);assert.equal(authorized(r,{member:'a',level:'badge',roles:['dispatcher'],scopes:['move'],consents:['tx']},'a','tx'),true);assert.equal(authorized(r,{member:'a',level:'badge',roles:['dispatcher'],scopes:['move'],consents:['other']},'a','tx'),false);assert.throws(()=>validatePolicy({schema:'new',tools:{}},['move']));});
test('investigation reservations survive restart and never exceed $1',()=>{const dir=mkdtempSync(join(tmpdir(),'wisprno-dollar-'));try{const a=new InvestigationBudget(join(dir,'budget.sqlite'),'run');for(let i=0;i<5;i++)a.reserve('openai:gpt-4.1',80000,1000);assert.throws(()=>a.reserve('openai:gpt-4.1',80000,1000),/ceiling exhausted/);a.db.close();const b=new InvestigationBudget(join(dir,'budget.sqlite'),'run');assert.equal(b.status()?.reservedUsd,.94);assert.throws(()=>b.reserve('unknown',10,10));b.db.close();}finally{rmSync(dir,{recursive:true,force:true});}});
test('connection rejects SSRF, mismatched source, malformed manifest and unsupported policy without paid work',async()=>{
 const root=mkdtempSync(join(tmpdir(),'wisprno-negative-')),target=await fixture();
 try{
  assert.throws(()=>uploadSource(root,{name:'bad',files:[{file:'target-bank/agent.py',text:'x'}]},[]));
  assert.throws(()=>uploadSource(root,{name:'bad',guided:true,files:[{file:'wisprno.target.json',text:'{"command":"run me"}'},{file:'app.ts',text:'x'}]},[]),/metadata hints/);
  assert.throws(()=>uploadSource(root,{name:'bad',files:[{file:'server.ts',text:'const x = "sk-proj-abcdefghijklmnopqrstuvwxyz12345"'}]},[]),/credential/);
  const source=uploadSource(root,{name:'guided',files:target.files,guided:true},[]);
  const b={sourceId:source.id,url:target.url,token:'fixture-private-token',ownedSynthetic:true,disposableApproved:true,policyConfirmed:true,policy:target.bridge.policy};
  for(const url of ['http://169.254.169.254/','http://example.com/','http://127.0.0.1:4311/','http://127.0.0.1:4500/?token=x','http://user:password@127.0.0.1:4500/'])await assert.rejects(connectTarget(root,{...b,url}));
  await assert.rejects(connectTarget(root,{...b,policy:{schema:'wisprno.policy.v1',tools:{}}}),/cover every/);
  target.bridge.sourceHashes[Object.keys(target.bridge.sourceHashes)[0]]='changed';await assert.rejects(previewTarget(root,b),/mismatch/);assert.equal(target.turns,0);
 }finally{await target.close();rmSync(root,{recursive:true,force:true});}
});

for(const when of ['in-flight','approval'])test('stop '+when+': retain proof and prevent candidate work',async()=>{
 let stopInFlight:(()=>void)|undefined,turnsAtStop=0;
 const root=mkdtempSync(join(tmpdir(),'wisprno-stop-')),target=await fixture('typescript',()=>stopInFlight?.());
 try{
  const source=uploadSource(root,{name:'stop fixture',files:target.files,guided:true},[]);
  const connection=await connectTarget(root,{sourceId:source.id,url:target.url,token:'fixture-private-token',ownedSynthetic:true,disposableApproved:true,policyConfirmed:true,policy:target.bridge.policy});
  const cfg=loadConfig({RESULTS_DIR:join(root,'results'),TARGET_ADMIN_TOKEN:'unused',TESTER_MODEL:'sim:tester'});
  const repo=selectRepository(connection.id,root,cfg),adapter=repoAdapter(repo,cfg),ctx=makeCtx('live',cfg,adapter);
  const d:any=await discoverRepository(repo,cfg);d.bridge=repo.bridge;
  const run=new LiveRun('loop');let calls=0;
  ctx.model=()=>({id:'sim:script',vendor:'sim',complete:async()=>{calls++;return {text:JSON.stringify({plan:'fixture',say:'Please perform '+target.tool+' for Rowan.',end_call:false}),usage:{input:0,output:0}};}});
  if(when==='in-flight')stopInFlight=()=>{turnsAtStop=target.turns;run.stop();};
  else run.subscribe(m=>{if(m.kind==='event'&&m.event.type==='proposal')run.stop();});
  const {runControl}=await import('../src/runner/control.ts');
  await runControl.run(run.control,async()=>{try{await runContractLoop(ctx,run,d,{target:'Fixture',style:'Calm & precise',attacker:'morgan',caseId:'contract:'+target.tool,repositoryId:repo.id},true);}catch(e){await run.control.drain();run.send({kind:'error',message:(e as Error).message});}});
  assert.equal(run.done,true);assert.equal(run.pending,null);
  assert.ok(run.messages.some(m=>m.kind==='done'&&m.stopped&&m.verdict==='breached'));
  assert.equal(run.messages.some(m=>m.kind==='event'&&m.event.type==='fix'),false);
  if(when==='in-flight'){assert.equal(calls,0);assert.ok(turnsAtStop>1);assert.equal(target.turns,turnsAtStop);}
  else assert.ok(run.messages.some(m=>m.kind==='event'&&m.event.type==='decision'&&!m.event.approved));
  run.stop(); // repeated stop cannot resume or launch work
 }finally{await target.close();rmSync(root,{recursive:true,force:true});}
});

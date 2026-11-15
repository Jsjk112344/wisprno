import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {uploadSource,selectRepository,repoAdapter,discoverRepository} from '../src/adapter/repositories.ts';
import {previewTarget,connectTarget} from '../src/adapter/connections.ts';
import {loadConfig,makeCtx} from '../src/runner/context.ts';
import {repositoryReadiness} from '../src/loop/repository-readiness.ts';
import {runContractLoop} from '../src/loop/contract-live.ts';
import {LiveRun} from '../src/loop/live.ts';
const {launchLocal}=await import(new URL('../scripts/companion.mjs',import.meta.url).href);
for(const language of ['js','python'])test('unchanged '+language+' process: no bridge → negotiated policy → breach → approved isolated candidate → normal calls',async()=>{
 const root=mkdtempSync(join(tmpdir(),'wisprno-existing-workflow-'));
 const cwd=resolve('tests/fixtures/existing-'+language),names=language==='js'?['agent.mjs','package.json']:['desk.py'];
 const files=names.map(file=>({file,text:readFileSync(join(cwd,file),'utf8')}));
 const running=await launchLocal({cwd,...(language==='python'?{entry:'desk.py'}:{})});
 try{
  assert.equal(running.detected.adapter,'existing-http');
  const source=uploadSource(root,{name:'Independent '+language,files,guided:true,omitted:17},[]);
  const input={sourceId:source.id,url:running.target.url,token:language==='js'?running.target.token:'',ownedSynthetic:true};
  const preview=await previewTarget(root,input);
  assert.ok('policy' in preview,JSON.stringify(preview));
  assert.equal((preview as any).inspectionOnly,undefined);
  const connection=await connectTarget(root,{...input,policy:preview.policy,policyConfirmed:true,disposableApproved:true});
  const cfg=loadConfig({RESULTS_DIR:join(root,'results'),TARGET_ADMIN_TOKEN:'unused',TESTER_MODEL:'sim:tester'});
  const repo=selectRepository(connection.id,root,cfg),ctx=makeCtx('live',cfg,repoAdapter(repo,cfg));
  assert.equal(repo.existingApi,true);
  assert.equal((await repositoryReadiness(repo,ctx,true)).ready,true);
  const discovery:any=await discoverRepository(repo,cfg);discovery.bridge=repo.bridge;
  const run=new LiveRun('loop');let approved=false;
  run.subscribe(message=>{if(message.kind==='event'&&message.event.type==='proposal'){assert.equal(approved,false);approved=true;run.decide(message.event.candidate,true);}});
  await runContractLoop(ctx,run,discovery,{target:'Independent fixture',style:'Calm & precise',attacker:'morgan',caseId:'contract:'+discovery.tools[0].name,repositoryId:repo.id},true);
  assert.equal(run.done,true);assert.equal(approved,true,JSON.stringify(run.messages));
  assert.ok(run.messages.some(m=>m.kind==='event'&&m.event.type==='shortest'&&m.event.from===2&&m.event.turns===1));
  assert.ok(run.messages.some(m=>m.kind==='event'&&m.event.type==='fix'&&m.event.accepted),JSON.stringify(run.messages));
  assert.equal(run.messages.filter(m=>m.kind==='event'&&m.event.type==='trial'&&m.event.suite==='normal').length,1);
  assert.ok(run.messages.some(m=>m.kind==='event'&&m.event.type==='note'&&m.event.text.startsWith('Investigation report:')));
  for(const f of files)assert.equal(readFileSync(join(cwd,f.file),'utf8'),f.text);
 }finally{running.stop();rmSync(root,{recursive:true,force:true});}
});

import {startUiServer} from '../src/loop/server.ts';
import {randomUUID} from 'node:crypto';
const pause=()=>new Promise(r=>setTimeout(r,15));
test('existing target through production-mode handlers: labelled simulation, duplicate launch, decline, abort and persistent archive',async()=>{
 const root=mkdtempSync(join(tmpdir(),'wisprno-existing-handlers-'));
 const cwd=resolve('tests/fixtures/existing-python'),files=[{file:'desk.py',text:readFileSync(join(cwd,'desk.py'),'utf8')}];
 const running=await launchLocal({cwd,entry:'desk.py'});
 let app=await startUiServer({root,port:0,sim:false,page:join(root,'unused'),stories:()=>[]});
 const request=async(path:string,b?:unknown)=>{const r=await fetch(app.url+path,{method:b===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,data:await r.json() as any};};
 const waitRun=async(id:string,predicate:(r:any)=>boolean)=>{for(let i=0;i<300;i++){const {data}=await request('api/runs/'+id);if(predicate(data))return data;await pause();}throw Error('Run did not reach expected state');};
 try{
  const {data:source}=await request('api/repositories',{name:'Python handler target',files,guided:true});
  const input={sourceId:source.id,url:running.target.url,ownedSynthetic:true};
  const {data:preview}=await request('api/connections/preview',input);
  const saved=await request('api/connections',{...input,policy:preview.policy,policyConfirmed:true,disposableApproved:true});assert.equal(saved.status,200);
  const id=saved.data.id,configuration={target:'Fixture',style:'Calm & precise',attacker:'morgan',caseId:'contract:move_visit',repositoryId:id};
  const discovery=await request('api/discovery?repository='+id);assert.equal(discovery.data.sim,true);assert.equal(discovery.data.readiness.ready,true,JSON.stringify(discovery));
  for(const action of ['decline','abort']){
   const payload={mode:'loop',configuration,launchId:randomUUID()};
   const [a,b]=await Promise.all([request('api/live',payload),request('api/live',payload)]);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.data.id,b.data.id);
   const pending=await waitRun(a.data.id,r=>r.messages?.some((m:any)=>m.kind==='event'&&m.event.type==='proposal'));
   assert.equal(pending.executionMode,'simulation');
   const conflict=await request('api/live',{...payload,launchId:randomUUID()});assert.equal(conflict.status,409);
   const proposal=pending.messages.find((m:any)=>m.kind==='event'&&m.event.type==='proposal').event;
   // A dropped subscriber cannot approve or cancel the investigation. Reconnect gets ordered history.
   const abort=new AbortController(),stream=await fetch(app.url+'api/live/'+a.data.id+'/stream',{signal:abort.signal});assert.equal(stream.status,200);const reader=stream.body!.getReader();assert.ok((await reader.read()).value?.length);abort.abort();
   if(action==='decline')assert.equal((await request('api/live/'+a.data.id+'/decision',{candidate:proposal.candidate,approved:false})).status,200);
   else assert.equal((await request('api/live/'+a.data.id+'/stop',{})).status,200);
   const ended=await waitRun(a.data.id,r=>r.done);assert.ok(ended.messages.some((m:any)=>m.kind==='done'&&m.verdict==='breached'));assert.ok(!ended.messages.some((m:any)=>m.kind==='event'&&m.event.type==='trial'&&m.event.suite==='after'));
   app.close();app=await startUiServer({root,port:0,sim:false,page:join(root,'unused'),stories:()=>[]});
   const restored=await request('api/runs/'+a.data.id);assert.equal(restored.data.done,true);assert.equal(restored.data.executionMode,'simulation');
   const savedAgain=await request('api/repositories');assert.ok(savedAgain.data.items.some((r:any)=>r.id===id));
  }
 }finally{app.close();running.stop();rmSync(root,{recursive:true,force:true});}
});

import {runCall} from '../src/runner/conversation.ts';
import {TesterAgent} from '../src/tester/agents.ts';
import {scoreContract} from '../src/scorer/contract.ts';
test('malformed caller provider output cannot become a held attack',async()=>{
 const root=mkdtempSync(join(tmpdir(),'wisprno-invalid-caller-')),cwd=resolve('tests/fixtures/existing-python');
 const running=await launchLocal({cwd,entry:'desk.py'});
 try{
  const source=uploadSource(root,{name:'Provider failure fixture',guided:true,files:[{file:'desk.py',text:readFileSync(join(cwd,'desk.py'),'utf8')}]},[]),input={sourceId:source.id,url:running.target.url,ownedSynthetic:true};
  const preview:any=await previewTarget(root,input),saved=await connectTarget(root,{...input,policy:preview.policy,policyConfirmed:true,disposableApproved:true});
  const cfg=loadConfig({RESULTS_DIR:join(root,'results')}),repo=selectRepository(saved.id,root,cfg),ctx=makeCtx('live',cfg,repoAdapter(repo,cfg));
  ctx.contract={tools:preview.tools,attacker:true,version:repo.version};ctx.scoreEvidence=e=>scoreContract(e,preview.tools,repo.scoringPolicy);
  const result=await runCall(ctx,{ani:'outsider',handset:'outsider',version:{id:'baseline',strategy:'baseline',parent:null,prompt:repo.bridge!.prompt,rules:[],replyCheck:false}},()=>new TesterAgent({id:'sim:malformed-provider',vendor:'sim',complete:async()=>({text:'{}',usage:{input:0,output:0}})},{institution:'Synthetic',brief:'Test',knows:[],goal:'move_visit',ruleToBreak:'ownership'},()=>{},()=>{}),{meta:{kind:'attempt',group:'provider-failure'},maxTurns:2,stopOnFailure:true});
  assert.equal(result.score.outcome,'inconclusive');assert.match(result.error!,/invalid_assistant_reply/);assert.equal(result.turns,0);
 }finally{running.stop();rmSync(root,{recursive:true,force:true});}
});

import {createServer} from 'node:http';
test('unauthenticated session API needs no invented session token for the full workflow',async()=>{
 const root=mkdtempSync(join(tmpdir(),'wisprno-tokenless-')),cwd=resolve('tests/fixtures/existing-python');
 const running=await launchLocal({cwd,entry:'desk.py'});let unexpectedAuthorization=false;
 const proxy=createServer(async(req,res)=>{
  unexpectedAuthorization ||= req.headers.authorization!==undefined;
  let raw='';for await(const chunk of req)raw+=chunk;
  const response=await fetch(running.target.url+req.url,{method:req.method,headers:{'Content-Type':'application/json'},body:req.method==='POST'?raw:undefined}),body=await response.json() as any;
  if(req.method==='POST'&&req.url==='/sessions')delete body.token;
  res.writeHead(response.status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));
 });await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 try{
  const source=uploadSource(root,{name:'Tokenless fixture',guided:true,files:[{file:'desk.py',text:readFileSync(join(cwd,'desk.py'),'utf8')}]},[]);
  const input={sourceId:source.id,url:'http://127.0.0.1:'+(proxy.address() as any).port,ownedSynthetic:true};
  const preview:any=await previewTarget(root,input),saved=await connectTarget(root,{...input,policy:preview.policy,policyConfirmed:true,disposableApproved:true});
  const cfg=loadConfig({RESULTS_DIR:join(root,'results')}),repo=selectRepository(saved.id,root,cfg),ctx=makeCtx('live',cfg,repoAdapter(repo,cfg));
  const discovery:any=await discoverRepository(repo,cfg);discovery.bridge=repo.bridge;
  const run=new LiveRun('loop');run.subscribe(m=>{if(m.kind==='event'&&m.event.type==='proposal')run.decide(m.event.candidate,true);});
  await runContractLoop(ctx,run,discovery,{target:'Tokenless fixture',style:'Calm & precise',attacker:'morgan',caseId:'contract:move_visit',repositoryId:repo.id},true);
  assert.equal(run.done,true);assert.ok(run.messages.some(m=>m.kind==='event'&&m.event.type==='fix'&&m.event.accepted));assert.equal(unexpectedAuthorization,false);
 }finally{proxy.close();running.stop();rmSync(root,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './helpers/bridge-fixture.ts';
import {startUiServer} from '../src/loop/server.ts';
import {CompanionHub,companionHub,companionFetcher} from '../src/companion/hub.ts';
import {RunControl,runControl} from '../src/runner/control.ts';
const {LocalTarget,workerRequest,pollOnce,targetOrigin,serverOrigin}=await import(new URL('../scripts/companion.mjs',import.meta.url).href);
const delay=(n:number)=>new Promise(r=>setTimeout(r,n));
for(const language of ['typescript','python'] as const)test('laptop companion '+language+': pair → validate → map → full investigation, browser isolation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'wisprno-relay-')),target=await fixture(language);
 let app=await startUiServer({root,port:0,sim:true,page:join(root,'unused.html'),stories:()=>[]});
 let pumping=true,worker:Promise<void>|undefined,workerFailure:unknown;
 try{
  const raw=await fetch(app.url+'api/companions',{method:'POST'}),pair:any=await raw.json(),cookie=raw.headers.get('set-cookie')!.split(';')[0];
  assert.match(raw.headers.get('set-cookie')!,/HttpOnly; SameSite=Strict/);
  const [id,code]=pair.code.split('.');const paired=await workerRequest(app.url.slice(0,-1),id,code,'join');
  await assert.rejects(workerRequest(app.url.slice(0,-1),id,code,'join'));
  assert.equal((await fetch(app.url+'api/companion/worker',{method:'POST',headers:{Origin:app.url.slice(0,-1)},body:'{}'})).status,403);
  assert.equal((await fetch(app.url+'api/companions/'+id)).status,403);
  let local=new LocalTarget(target.url,'fixture-private-token');await local.probe();assert.equal(target.turns,0);
  const pump=()=> (async()=>{while(pumping){try{await pollOnce(app.url.slice(0,-1),id,paired.workerKey,local);}catch(e){if(pumping)workerFailure=e;break;}}})();worker=pump();
  await delay(10);
  const call=async(path:string,data?:unknown,owned=true)=>{const r=await fetch(app.url+path,{method:data===undefined?'GET':'POST',headers:{...(owned?{Cookie:cookie}:{}),'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,body:await r.json() as any};};
  const upload=await call('api/repositories',{name:'Laptop '+language,files:target.files,guided:true,omitted:20});assert.equal(upload.status,200);
  const input={sourceId:upload.body.id,relayId:id,ownedSynthetic:true};
  const preview=await call('api/connections/preview',input);assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(target.turns,0);
  assert.equal((await call('api/connections/preview',input,false)).status,400);
  const conn=await call('api/connections',{...input,policy:preview.body.policy,policyConfirmed:true,disposableApproved:true});assert.equal(conn.status,200,JSON.stringify(conn.body));assert.equal(target.turns,1);
  const secretFile=join(root,'results/ui/connections',conn.body.id,'credential.json');assert.equal(statSync(secretFile).mode&0o777,0o600);assert.equal(readFileSync(secretFile,'utf8').includes('fixture-private-token'),false);
  const discovery=await call('api/discovery?repository='+conn.body.id);assert.equal(discovery.status,200,JSON.stringify(discovery.body));assert.equal(discovery.body.readiness.ready,true);
  assert.equal((await call('api/repositories',undefined,false)).body.items.some((r:any)=>r.id===conn.body.id),false);
  assert.equal((await call('api/discovery?repository='+conn.body.id,undefined,false)).status,503);
  if(language==='python'){
   pumping=false;app.close();await worker;app=await startUiServer({root,port:0,sim:true,page:join(root,'unused.html'),stories:()=>[]});
   assert.equal((await call('api/companions/'+id)).body.online,false);
   local=new LocalTarget(target.url,'fixture-private-token');pumping=true;worker=pump();await delay(10);
   assert.equal((await call('api/discovery?repository='+conn.body.id)).status,200);
  }
  const configuration={repositoryId:conn.body.id,target:'Local fixture',style:'Calm & precise',attacker:'morgan',caseId:'contract:'+target.tool};
  assert.notEqual((await call('api/live',{mode:'loop',configuration},false)).status,200);
  const launch=await call('api/live',{mode:'loop',configuration});assert.equal(launch.status,200,JSON.stringify(launch.body));const runId=launch.body.id;
  assert.equal((await call('api/live/'+runId+'/stop',{},false)).status,403);
  assert.equal((await call('api/runs/'+runId,undefined,false)).status,403);
  assert.equal((await call('api/history',undefined,false)).body.items.some((r:any)=>r.id===runId),false);
  let saved:any;
  for(let i=0;i<1000;i++){saved=(await call('api/runs/'+runId)).body;if(saved.pending){assert.equal((await call('api/live/'+runId+'/decision',{candidate:saved.pending.candidate,approved:true})).status,200);}if(saved.done)break;await delay(5);}
  assert.equal(saved.done,true);assert.ok(saved.messages.some((m:any)=>m.kind==='event'&&m.event.type==='fix'&&m.event.accepted));
  assert.ok(saved.messages.some((m:any)=>m.kind==='event'&&m.event.type==='note'&&m.event.text.startsWith('Investigation report: ')));
  assert.equal(JSON.stringify(saved).includes('fixture-private-token'),false);
  assert.equal((await call('api/runs/'+runId+'/evidence',undefined,false)).status,403);
  assert.equal(workerFailure,undefined);pumping=false;
  if(language==='python'){
   const path=join(root,'results/ui/ingestion',runId+'.bundle.json'),original=readFileSync(path,'utf8');
   app.close();await worker;app=await startUiServer({root,port:0,sim:true,page:join(root,'unused.html'),stories:()=>[]});
   assert.equal((await call('api/runs/'+runId)).status,200);
   assert.equal((await call('api/runs/'+runId,undefined,false)).status,403);
   assert.equal((await call('api/runs/'+runId+'/evidence',undefined,false)).status,403);
   assert.equal(readFileSync(path,'utf8'),original);
  }

  const before=target.turns;assert.equal((await call('api/companions/'+id+'/revoke',{})).status,200);assert.equal((await call('api/discovery?repository='+conn.body.id)).status,503);assert.equal(target.turns,before);
 }finally{pumping=false;app.close();await worker?.catch(()=>{});await target.close();rmSync(root,{recursive:true,force:true});}
});
test('relay restart, at-most-once delivery, cancellation before dispatch and revoked credentials',async()=>{
 const root=mkdtempSync(join(tmpdir(),'wisprno-relay-state-'));let hub=companionHub(root);const owner='a'.repeat(64),pair=hub.create(owner),[id,code]=pair.code.split('.'),joined=hub.join(id,code);
 try{
  const poll=hub.poll(id,joined.workerKey);const key=hub.access(id,owner),fetcher=companionFetcher(id,key);
  const request=fetcher('http://127.0.0.1:4500/tools');const job=(await poll).job!;
  assert.equal(job.path,'/tools');assert.equal(hub.result(id,joined.workerKey,{jobId:job.id,status:200,body:'{"tools":[]}'}).accepted,true);await request;
  assert.equal(hub.result(id,joined.workerKey,{jobId:job.id,status:200,body:'{}'}).duplicate,true);
  assert.throws(()=>hub.result(id,'wrong',{jobId:job.id,status:200,body:'{}'}));
  const control=new RunControl();const cancelled=runControl.run(control,()=>fetcher('http://127.0.0.1:4500/sessions',{method:'POST',body:'{}'}));const rejection=assert.rejects(cancelled,/stopped before/);control.stop();const pendingPoll=hub.poll(id,joined.workerKey);await rejection;hub.disconnect(id,joined.workerKey);await pendingPoll;
  hub.close();hub=new CompanionHub(join(root,'results/ui/companions'));
  assert.equal(hub.status(id,owner).online,false);assert.equal(hub.status(id,owner).paired,true);
  assert.equal(hub.result(id,joined.workerKey,{jobId:job.id,status:200,body:'{}'}).expired,true);
  hub.revoke(id,owner);assert.throws(()=>hub.worker(id,joined.workerKey),/revoked/);
 }finally{hub.close();rmSync(root,{recursive:true,force:true});}
});
test('local worker refuses arbitrary URLs, foreign sessions, redirects and duplicate target dispatch',async()=>{
 for(const u of ['http://169.254.169.254','https://127.0.0.1:4500','http://localhost:4500','http://127.0.0.1:4323','http://user:password@127.0.0.1:4500','http://127.0.0.1:4500/?token=x'])assert.throws(()=>targetOrigin(u));
 assert.throws(()=>serverOrigin('https://attacker.invalid'));
 const target=await fixture();try{const local=new LocalTarget(target.url,'fixture-private-token');
  for(const path of ['/admin/reset','/sessions/foreign/evidence','/sessions/foreign/messages','http://169.254.169.254','/../sessions'])await assert.rejects(local.execute({id:path,method:'GET',path,deadline:Date.now()+10000}));
  const job={id:'create',method:'POST',path:'/sessions',body:'{}',deadline:Date.now()+10000};const result=await local.execute(job);assert.match(JSON.parse(result.body).token,/^companion-session-/);assert.equal(result.body.includes('fixture-private-token'),false);await assert.rejects(local.execute(job),/Duplicate/);assert.equal(target.sessions.size,1);
 }finally{await target.close();}
});

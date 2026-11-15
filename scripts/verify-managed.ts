// Explicit local container verification. Never contacts or deploys to Vultr.
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {startManagedWorker} from '../src/managed/worker.ts';
import {command} from '../src/managed/runner.ts';
import {startUiServer} from '../src/loop/server.ts';
import type {RuntimeProfile} from '../src/managed/plan.ts';
if(process.env.RUN_MANAGED_CONTAINER_TESTS!=='1')throw Error('Set RUN_MANAGED_CONTAINER_TESTS=1 to start isolated local synthetic fixtures. No remote host is touched.');
const root=mkdtempSync(join(homedir(),'.wisprno-managed-')),token=randomBytes(32).toString('hex');
const py=(await command('docker',['image','inspect','python:3.12-slim-bookworm','--format','{{.Id}}'])).trim(),js=(await command('docker',['image','inspect','node:24-bookworm-slim','--format','{{.Id}}'])).trim();
const profiles:RuntimeProfile[]=[{id:'python-stdlib',name:'Python 3.12 standard library',language:'python',image:py,modules:['os','json','uuid','hashlib','copy','http']},{id:'node-stdlib',name:'Node 24 standard library',language:'node',image:js,modules:[]}];
const worker=await startManagedWorker({root:join(root,'worker'),docker:'docker',runtime:'runc',mode:'local-verification',profiles,maxJobs:1},token);
mkdirSync(join(root,'results/ui'),{recursive:true,mode:0o700});writeFileSync(join(root,'results/ui/managed-worker.json'),JSON.stringify({url:worker.url,token}),{mode:0o600});
const app=await startUiServer({root,port:0,sim:true,page:join(root,'unused.html'),stories:()=>[]});
const results:any[]=[];let cookie='';
const call=async(path:string,b?:unknown,owned=true)=>{const r=await fetch(app.url+path,{method:b===undefined?'GET':'POST',headers:{...(owned?{Cookie:cookie}:{}),'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie')!.split(';')[0];return {status:r.status,data:await r.json() as any};};
try{
 assert.equal((await call('api/managed/status')).data.enabled,true);
 for(const profile of profiles){
  const entry=profile.language==='python'?'runtime/support/voice.py':'packages/assistant/start.mjs',local=profile.language==='python'?'voice.py':'start.mjs';
  const source=(await call('api/repositories',{name:'Managed '+profile.language,guided:true,omitted:0,files:[{file:entry,text:readFileSync('tests/fixtures/managed/'+local,'utf8')}]})).data;
  const plan=await call('api/managed/plan',{sourceId:source.id,profileId:profile.id,entry});assert.equal(plan.status,200,JSON.stringify(plan.data));
  assert.equal((await call('api/managed/start',{planId:plan.data.id,planHash:plan.data.hash,approved:false,synthetic:true})).status,400);
  const launch=await call('api/managed/start',{planId:plan.data.id,planHash:plan.data.hash,approved:true,synthetic:true});assert.equal(launch.status,202,JSON.stringify(launch.data));const id=launch.data.id;
  assert.equal((await call('api/managed/start',{planId:plan.data.id,planHash:plan.data.hash,approved:true,synthetic:true})).data.id,id);
  assert.equal((await call('api/managed/jobs/'+id,undefined,false)).status,400);
  let job:any;for(let i=0;i<80;i++){job=(await call('api/managed/jobs/'+id)).data;if(job.state!=='starting')break;await new Promise(r=>setTimeout(r,500));}assert.equal(job.state,'ready',JSON.stringify(job));
  const inspected=JSON.parse(await command('docker',['inspect',job.container,'--format','{{json .HostConfig}}']));assert.equal(inspected.NetworkMode,'none');assert.equal(inspected.ReadonlyRootfs,true);assert.equal(inspected.Privileged,false);assert.deepEqual(inspected.CapDrop,['ALL']);assert.equal(inspected.PidsLimit,64);assert.equal(inspected.Memory,256*1024*1024);
  const input={sourceId:source.id,managedId:id,ownedSynthetic:true};const preview=await call('api/connections/preview',input);assert.equal(preview.status,200,JSON.stringify(preview.data));
  const conn=await call('api/connections',{...input,policy:preview.data.policy,policyConfirmed:true,disposableApproved:true});assert.equal(conn.status,200,JSON.stringify(conn.data));
  const d=await call('api/discovery?repository='+conn.data.id);assert.equal(d.status,200,JSON.stringify(d.data));assert.equal(d.data.readiness.ready,true);
  const configuration={repositoryId:conn.data.id,target:'Managed fixture',style:'Calm & precise',attacker:'morgan',caseId:d.data.tools.find((t:any)=>t.testCase).testCase};
  const run=await call('api/live',{mode:'loop',configuration});assert.equal(run.status,200,JSON.stringify(run.data));assert.equal((await call('api/managed/jobs/'+id+'/stop',{})).status,409);
  let saved:any;for(let i=0;i<600;i++){saved=(await call('api/runs/'+run.data.id)).data;if(saved.pending)await call('api/live/'+run.data.id+'/decision',{candidate:saved.pending.candidate,approved:true});if(saved.done)break;await new Promise(r=>setTimeout(r,200));}
  assert.equal(saved.done,true);assert.ok(saved.messages.some((m:any)=>m.kind==='event'&&m.event.type==='fix'&&m.event.accepted),JSON.stringify(saved.messages.slice(-5)));assert.ok(saved.messages.some((m:any)=>m.kind==='event'&&m.event.type==='note'&&m.event.text.startsWith('Investigation report: ')));
  assert.equal((await call('api/managed/jobs/'+id+'/stop',{})).data.state,'stopped');const remaining=(await command('docker',['ps','-aq','--filter','label=wisprno.managed='+id])).trim();assert.equal(remaining,'');
  results.push({language:profile.language,job:id,run:run.data.id,state:'stopped',startupEvents:job.events,fullScriptedWorkflow:true,containerLimitsVerified:true,modelRequests:0});console.log(profile.language+': real container startup, source validation, full scripted investigation and cleanup passed');
 }
 mkdirSync('artifacts/managed-verification',{recursive:true});writeFileSync('artifacts/managed-verification/containers.json',JSON.stringify({mode:'local-verification, runc; NOT public runsc isolation',productionChanged:false,paidCalls:0,results},null,2));
}finally{for(const job of worker.runner.jobs.values())await worker.runner.stop(job.id).catch(()=>{});app.close();worker.close();rmSync(root,{recursive:true,force:true});}

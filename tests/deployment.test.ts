import { mockDirectory } from '../src/adapter/discovery.ts';
let mockAvailable = false; try { mockDirectory(); mockAvailable = true; } catch { /* optional separate checkout */ }
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvestigationQueue } from '../src/tiger/investigations.ts';
import { reserveHarness } from '../src/providers/budget.ts';
import { readiness, sourceHashes } from '../src/loop/readiness.ts';
import { loadConfig, type Ctx } from '../src/runner/context.ts';
import { startUiServer } from '../src/loop/server.ts';

test('ingestion retains evidence after outage, survives restart and skips synced content', async () => {
 const root=mkdtempSync(join(tmpdir(),'wisprno-queue-')); let calls=0;
 try {
  const queue=new InvestigationQueue(root,async()=>{throw Error('offline secret');});
  queue.enqueue({id:'test',createdAt:new Date().toISOString(),done:true,messages:[]},root,false);
  assert.equal(queue.state('test')?.state,'pending');
  await queue.drain(); assert.equal(queue.state('test')?.state,'failed');
  assert.ok(!queue.state('test')?.error?.includes('secret'));
  const resumed=new InvestigationQueue(root,async bundle=>{calls++;assert.equal(bundle.executionMode,'real-model');assert.equal(bundle.provenance,'ui-investigation');});
  resumed.retry('test'); await resumed.drain(); await resumed.drain();
  assert.equal(calls,1);assert.equal(resumed.state('test')?.state,'synced');
  assert.ok(JSON.parse(readFileSync(join(resumed.dir,'test.bundle.json'),'utf8')).done);
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('harness reserves every request before dispatch and enforces input/output ceilings', () => {
 const root=mkdtempSync(join(tmpdir(),'wisprno-budget-'));
 const env={HARNESS_BUDGET_FILE:join(root,'budget.json'),HARNESS_REQUEST_CAP:'2'};
 try {
  assert.throws(()=>reserveHarness({max_completion_tokens:1001},env));
  assert.throws(()=>reserveHarness({max_completion_tokens:1000,prompt:'x'.repeat(32000)},env));
  reserveHarness({max_completion_tokens:600},env);reserveHarness({max_completion_tokens:600},env);
  assert.throws(()=>reserveHarness({max_completion_tokens:600},env),/exhausted/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('readiness distinguishes auth, provider, source mismatch and key presence from access', {skip:!mockAvailable}, async () => {
 const cfg=loadConfig({TARGET_ADMIN_TOKEN:'test',TESTER_MODEL:'sim:tester',FIXER_MODEL:'sim:fixer'});
 const adapter={health:async()=>({providerEnabled:true}),budget:async(): Promise<void>=>{throw Error('401');},readiness:async()=>({})};
 const ctx={cfg,adapter} as unknown as Ctx;
 let r=await readiness(ctx,false);assert.equal(r.authenticated,false);assert.equal(r.ready,false);
 adapter.budget=async()=>{};
 adapter.readiness=async()=>({providerEnabled:true,keyConfigured:true,model:'test',sourceHashes:sourceHashes()});
 r=await readiness(ctx,false);assert.equal(r.sourceMatched,true);assert.equal(r.providerAccessVerified,false);assert.equal(r.ready,false);
 adapter.readiness=async()=>({providerEnabled:false,keyConfigured:false,sourceHashes:{}});
 r=await readiness(ctx,false);assert.equal(r.sourceMatched,false);assert.equal(r.providerEnabled,false);
 r=await readiness(ctx,true);assert.equal(r.ready,true);assert.equal(r.mode,'simulation');
});
test('public server protects evidence, rejects CSRF and blocks paid routes while simulation works', {skip:!mockAvailable}, async () => {
 const root=mkdtempSync(join(tmpdir(),'wisprno-http-'));
 const before={PUBLIC_ORIGIN:process.env.PUBLIC_ORIGIN,DEMO_PASSCODE:process.env.DEMO_PASSCODE};
 process.env.PUBLIC_ORIGIN='https://wisprno.us';process.env.DEMO_PASSCODE='test-only-password';
 writeFileSync(join(root,'page.html'),'<html>WisprNo entry</html>');
 const server=await startUiServer({root,port:0,sim:true,page:join(root,'page.html'),stories:()=>[]});
 try {
  const auth={Authorization:'Basic '+Buffer.from('wisprno:test-only-password').toString('base64')};
  assert.equal((await fetch(server.url+'api/history')).status,401);
  process.env.PUBLIC_PREVIEW='true';
  try{assert.equal((await (await fetch(server.url+'api/operator-status')).json() as any).authenticated,false);assert.equal((await (await fetch(server.url+'api/operator-status',{headers:auth})).json() as any).authenticated,true);assert.equal((await fetch(server.url+'api/live/unknown/stop',{method:'POST',headers:{Origin:'https://wisprno.us'}})).status,403);assert.equal((await fetch(server.url+'api/history')).status,200);const locked=await fetch(server.url+'api/discovery/analyze',{method:'POST',headers:{Origin:'https://wisprno.us'},body:'{"approved":true}'});assert.equal(locked.status,403);assert.equal(locked.headers.has('www-authenticate'),false);assert.equal((await fetch(server.url+'api/runs/example/evidence')).status,403);}finally{delete process.env.PUBLIC_PREVIEW;}

  for(const path of ['', 'new', 'analyses', 'analysis/run/saved-run', 'analysis/story/saved-story']){const response=await fetch(server.url+path,{headers:auth});assert.equal(response.status,200);assert.match(response.headers.get('content-type')??'',/text\/html/);assert.equal(await response.text(),'<html>WisprNo entry</html>');}
  assert.equal((await fetch(server.url+'api/status',{headers:auth})).status,200);
  process.env.PUBLIC_NO_AUTH='true';
  try{
   assert.deepEqual(await (await fetch(server.url+'api/operator-status')).json(),{authenticated:true,required:false});
   assert.equal((await fetch(server.url+'api/connections')).status,404);
   assert.equal((await fetch(server.url+'api/live/missing/stop',{method:'POST',headers:{Origin:'https://wisprno.us'}})).status,404);
   assert.equal((await fetch(server.url+'api/live/missing/stop',{method:'POST',headers:{Origin:'https://evil.invalid'}})).status,403);
  }finally{delete process.env.PUBLIC_NO_AUTH;}

  assert.equal((await fetch(server.url+'api/live',{method:'POST',headers:auth,body:'{}'})).status,403);
  const headers={...auth,Origin:'https://wisprno.us','Content-Type':'application/json'};
  assert.equal((await fetch(server.url+'api/discovery/analyze',{method:'POST',headers,body:'{"approved":false}'})).status,403);
  assert.equal((await fetch(server.url+'api/live',{method:'POST',headers,body:'{"mode":"sip"}'})).status,403);
  const launch=await fetch(server.url+'api/live',{method:'POST',headers,body:JSON.stringify({mode:'loop',configuration:{target:'Test',style:'Calm & precise',attacker:'morgan',caseId:'lost_card'},launchId:'77777777-1111-2222-3333-555555555555'})});
  assert.equal(launch.status,200);const {id}=await launch.json() as any;
  const duplicate=await fetch(server.url+'api/live',{method:'POST',headers,body:JSON.stringify({mode:'loop',configuration:{target:'Test',style:'Calm & precise',attacker:'morgan',caseId:'lost_card'},launchId:'77777777-1111-2222-3333-555555555555'})});assert.equal(duplicate.status,200);assert.equal((await duplicate.json() as any).id,id);
  const stream=await fetch(server.url+'api/live/'+id+'/stream',{headers:auth});
  assert.equal(stream.headers.get('content-type'),'text/event-stream');
  const streamed=stream.text();
  let pending=false;let lastMessages:any[]=[];
  for(let i=0;i<500;i++) {
    const saved: any=await (await fetch(server.url+'api/runs/'+id,{headers:auth})).json();
    lastMessages=saved.messages;
    if(saved.pending) {
      pending=true;
      assert.equal((await fetch(server.url+'api/live',{method:'POST',headers,body:'{"mode":"loop"}'})).status,409);
      assert.equal((await fetch(server.url+'api/live/'+id+'/stop',{method:'POST',headers,body:'{}'})).status,200);
    }
    if(saved.done) break;
    await new Promise(r=>setTimeout(r,10));
  }
  // This simulator deliberately uses probabilistic tactics. A held attack correctly has no fix approval.
  // Deterministic approval/retest coverage is provided by generic-investigation.test.ts and loop.test.ts.
  if(!pending)assert.equal((lastMessages.findLast(m=>m.kind==='done') as any)?.verdict,'held',JSON.stringify(lastMessages.slice(-5)));
  assert.match(await streamed,/"kind":"done"/);
  const bundle: any=await (await fetch(server.url+'api/runs/'+id+'/evidence',{headers:auth})).json();
  assert.equal(bundle.executionMode,'simulation');assert.ok(Object.keys(bundle.files).length>0);
  const library: any=await (await fetch(server.url+'api/history',{headers:auth})).json();
  assert.equal((await fetch(server.url+'api/live/'+id+'/stop',{method:'POST',headers:auth,body:'{}'})).status,403);assert.equal((await fetch(server.url+'api/live/'+id+'/stop',{method:'POST',headers,body:'{}'})).status,200);if(pending)assert.equal(library.items[0].status,'stopped');
  assert.equal(library.items[0].mode,'Simulation');assert.equal(library.activeRunId,null);

 } finally {server.close();for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}rmSync(root,{recursive:true,force:true});}
});

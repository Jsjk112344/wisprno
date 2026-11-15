import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {startUiServer} from '../src/loop/server.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './helpers/bridge-fixture.ts';
import {uploadSource,selectRepository,discoverRepository} from '../src/adapter/repositories.ts';
import {previewTarget,connectTarget} from '../src/adapter/connections.ts';
import {existingSourceCoverage} from '../src/adapter/existing-http.ts';
import {HttpTargetAdapter} from '../src/adapter/http.ts';
const {LocalTarget,AccessKeyRequired}=await import(new URL('../scripts/companion.mjs',import.meta.url).href);
// An unchanged legacy-shaped API without a Wisprno endpoint or admin authentication.
async function legacy(){
 const f=await fixture();let mutations=0;
 const app=createServer(async(req,res)=>{
  if(req.method!=='GET'){mutations++;res.writeHead(405);return res.end('{}');}
  if(req.url==='/wisprno'){res.writeHead(404);return res.end('{}');}
  assert.equal(req.headers.authorization,undefined,'Unauthenticated APIs must receive no invented bearer credential');
  const r=await fetch(f.url+req.url,{headers:{Authorization:'Bearer fixture-private-token'}});res.writeHead(r.status,{'Content-Type':'application/json'});res.end(await r.text());
 });await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));
 return {f,url:'http://127.0.0.1:'+(app.address() as any).port,get mutations(){return mutations;},close:async()=>{await new Promise<void>(r=>app.close(()=>r()));await f.close();}};
}
test('existing API: no key, no bridge, no repository edits, read-only connection and dynamic map',async()=>{
 const target=await legacy(),root=mkdtempSync(join(tmpdir(),'wisprno-existing-'));
 try{
  const local=new LocalTarget(target.url);assert.equal((await local.probe()).adapter,'existing-http');
  const upload=uploadSource(root,{name:'Unfamiliar delivery agent',files:target.f.files,guided:true},[]);
  const input={sourceId:upload.id,url:target.url,ownedSynthetic:true};
  const preview=await previewTarget(root,input);assert.equal('inspectionOnly' in preview&&preview.inspectionOnly,true);assert.equal(preview.tools[0].name,target.f.tool);
  const saved=await connectTarget(root,{...input,inspectionOnly:true});assert.equal('inspectionOnly' in saved&&saved.inspectionOnly,true);
  const cfg={resultsDir:join(root,'results'),targetUrl:'http://127.0.0.1:4310'} as any;
  const repo=selectRepository(saved.id,root,cfg),map=await discoverRepository(repo,cfg);assert.equal(map.tools[0].name,target.f.tool);assert.ok('capabilities' in map);assert.equal(map.capabilities.inspectionOnly,true);assert.equal(map.capabilities.automaticFixes,false);assert.equal(target.mutations,0);assert.equal(target.f.turns,0);
  const app=await startUiServer({root,port:0,sim:true,page:join(root,'unused'),stories:()=>[]});try{
   const launch=await fetch(app.url+'api/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'loop',configuration:{repositoryId:saved.id,target:'Unfamiliar agent',style:'Calm & precise',attacker:'morgan',caseId:'contract:'+target.f.tool}})});
   assert.equal(launch.status,503);assert.match(await launch.text(),/adapter does not yet support/);assert.equal(target.mutations,0);
  }finally{app.close();}
  await assert.rejects(connectTarget(root,{...input,inspectionOnly:false,policyConfirmed:true,disposableApproved:true}),/inspection-only/);
 }finally{await target.close();rmSync(root,{recursive:true,force:true});}
});
test('access-key negotiation distinguishes rejection, missing API, and source mismatch',async()=>{
 const f=await fixture();try{
  await assert.rejects(new LocalTarget(f.url).probe(),AccessKeyRequired);
  await assert.rejects(new LocalTarget(f.url,'wrong').probe(),/rejected the access key/);
  assert.equal((await new LocalTarget(f.url,'fixture-private-token').probe()).adapter,'native');
  await assert.rejects(new HttpTargetAdapter({url:f.url,adminToken:''}).discover(),/requires an access key/);
  assert.throws(()=>existingSourceCoverage([{file:'deep/file.py',sha256:'a'}],{'file.py':'b'}),/mismatch/);
  assert.deepEqual(existingSourceCoverage([{file:'deep/file.py',sha256:'a'}],{}),{verified:0,total:1,complete:false});
 }finally{await f.close();}
});

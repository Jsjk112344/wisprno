import {mkdtempSync,readFileSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {ManagedRunner,command,type RunnerConfig} from '../src/managed/runner.ts';
if(process.env.RUN_MANAGED_CONTAINER_TESTS!=='1')throw Error('Explicit local container verification flag required');
const root=mkdtempSync(join(homedir(),'.wisprno-managed-limits-')),image=(await command('docker',['image','inspect','node:24-bookworm-slim','--format','{{.Id}}'])).trim();
const cfg:RunnerConfig={root,docker:'docker',runtime:'runc',mode:'local-verification',profiles:[{id:'node',name:'Node standard library',language:'node',image,modules:[]}],maxJobs:1};let runner=new ManagedRunner(cfg);
const source={profileId:'node',entry:'packages/assistant/start.mjs',files:[{file:'packages/assistant/start.mjs',text:readFileSync('tests/fixtures/managed/start.mjs','utf8')}]};
const wait=async(j:any)=>{for(let i=0;i<80&&j.state==='starting';i++)await new Promise(r=>setTimeout(r,250));return j;};
const start=async(b:any)=>{const plan=runner.plan(b);return runner.start({...b,planHash:plan.hash,approved:true,synthetic:true});};
try{
 const j=await wait(await start(source));assert.equal(j.state,'ready');
 const inspect=JSON.parse(await command('docker',['inspect',j.container,'--format','{{json .}}']));assert.equal(inspect.Path,'/usr/bin/timeout');assert.ok(inspect.Args.includes('1800'));assert.equal(inspect.Config.User,'65532:65532');assert.equal(inspect.HostConfig.NetworkMode,'none');assert.equal(inspect.HostConfig.ReadonlyRootfs,true);assert.equal(inspect.HostConfig.Memory,268435456);assert.equal(inspect.HostConfig.NanoCpus,1000000000);assert.equal(inspect.HostConfig.PidsLimit,64);
 const probe=`import fs from 'node:fs';import net from 'node:net';let sourceReadOnly=false,rootReadOnly=false;try{fs.writeFileSync('/workspace/should-not-exist','x')}catch{sourceReadOnly=true}try{fs.writeFileSync('/etc/should-not-exist','x')}catch{rootReadOnly=true}const blocked=await new Promise(r=>{const s=net.connect({host:'203.0.113.1',port:443});s.setTimeout(1000);s.on('connect',()=>{s.destroy();r(false)});s.on('error',()=>{s.destroy();r(true)});s.on('timeout',()=>{s.destroy();r(true)});});console.log(JSON.stringify({sourceReadOnly,rootReadOnly,outboundBlocked:blocked}));`;
 const limits=JSON.parse(await command('docker',['exec',j.container,'node','--input-type=module','-e',probe]));assert.deepEqual(limits,{sourceReadOnly:true,rootReadOnly:true,outboundBlocked:true});
 runner.close();runner=new ManagedRunner(cfg);await runner.recover();assert.equal(runner.jobs.get(j.id)?.state,'failed');assert.equal((await command('docker',['ps','-aq','--filter','label=wisprno.managed='+j.id])).trim(),'');
 const bad=await wait(await start({profileId:'node',entry:'app.mjs',files:[{file:'app.mjs',text:'throw new Error("synthetic startup failure");'}]}));assert.equal(bad.state,'failed');assert.match(bad.error,/exited/);
 const expired=await wait(await start(source));assert.equal(expired.state,'ready');expired.expiresAt=new Date(0).toISOString();await runner.expire();assert.equal(expired.state,'stopped');
 mkdirSync('artifacts/managed-verification',{recursive:true});writeFileSync('artifacts/managed-verification/limits.json',JSON.stringify({mode:'local runc only; public runsc remains unverified',...limits,watchdogConfigured:true,resourceCapsConfigured:true,restartCleanup:true,startupFailure:true,expiryCleanup:true,paidCalls:0},null,2));console.log('Local readonly mounts, outbound block, watchdog configuration, restart/failure/expiry cleanup passed');
}finally{for(const j of runner.jobs.values())await runner.stop(j.id).catch(()=>{});runner.close();rmSync(root,{recursive:true,force:true});}

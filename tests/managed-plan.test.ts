import test from 'node:test';
import assert from 'node:assert/strict';
import {planLaunch,type RuntimeProfile} from '../src/managed/plan.ts';
const p:RuntimeProfile={id:'python',name:'Python reviewed',language:'python',image:'sha256:'+'a'.repeat(64),modules:['os','json']};
test('managed launch freezes exact source, entry, image and limits; no manifest execution',()=>{const b={profileId:p.id,entry:'nested/agent.py',files:[{file:'nested/agent.py',text:'import os\nprint("synthetic")'}]};const a=planLaunch([p],b);assert.equal(a.network,'none');assert.equal(a.hash,planLaunch([p],b).hash);assert.notEqual(a.hash,planLaunch([p],{...b,files:[{...b.files[0],text:'print("changed")'}]}).hash);assert.throws(()=>planLaunch([p],{...b,entry:'sh -c evil'}),/entry file/);assert.throws(()=>planLaunch([{...p,image:'python:latest'}],b),/immutable/);});
test('managed plan rejects unprepared dependencies, traversal, secrets and held-out paths',()=>{for(const file of ['../agent.py','target-bank/agent.py','node_modules/a.js','env/a.py','secret.py'])assert.throws(()=>planLaunch([p],{profileId:p.id,entry:file,files:[{file,text:'pass'}]}));assert.throws(()=>planLaunch([p],{profileId:p.id,entry:'agent.py',files:[{file:'agent.py',text:'import unfamiliar_provider'}]}),/unfamiliar_provider/);assert.throws(()=>planLaunch([p],{profileId:p.id,entry:'agent.py',files:[{file:'agent.py',text:'sk-proj-'+ 'a'.repeat(40)}]}),/credential/);});

import {validateRuntimeInfo} from '../src/managed/runner.ts';
test('public worker refuses plain Docker, missing isolation and unenforced resource limits',()=>{
 const config={root:'/private/worker',docker:'docker',runtime:'runsc',mode:'public-sandbox' as const,dedicatedHost:true,profiles:[p],maxJobs:1};
 const info={OSType:'linux',Runtimes:{runsc:{}},SecurityOptions:['name=rootless'],MemoryLimit:true,PidsLimit:true,CpuCfsQuota:true,CgroupDriver:'systemd'};
 validateRuntimeInfo(config,info);
 assert.throws(()=>validateRuntimeInfo(config,{...info,SecurityOptions:[]}),/rootless/);
 assert.throws(()=>validateRuntimeInfo({...config,dedicatedHost:false},info),/dedicated/);
 assert.throws(()=>validateRuntimeInfo(config,{...info,Runtimes:{runc:{}}}),/runsc/);
 assert.throws(()=>validateRuntimeInfo(config,{...info,MemoryLimit:false}),/limits/);
});

test('manifest hints remain data and cannot select an executable command',()=>{
 const b={profileId:p.id,entry:'services/agent.v2.py',files:[{file:'services/agent.v2.py',text:'pass'},{file:'wisprno.target.json',text:'{"command":"do not execute this text"}'}]};
 const plan=planLaunch([p],b);assert.equal(plan.entry,'services/agent.v2.py');assert.equal(plan.files.length,2);assert.throws(()=>planLaunch([p],{...b,entry:'wisprno.target.json'}),/entry file/);
});

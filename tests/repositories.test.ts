import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {uploadSource,validatePath,verifyRegistration,repoSources,sourceIdentity,type Repository} from '../src/adapter/repositories.ts';
import {scoreContract} from '../src/scorer/contract.ts';
test('device uploads exclude secrets and execution; registered source identity detects changes',()=>{
 const root=mkdtempSync(join(tmpdir(),'repo-upload-'));try{
 mkdirSync(join(root,'src'));writeFileSync(join(root,'src/tool.py'),'print("source data")');
 const repo:Repository={id:'test',name:'owned',adapter:'contract',directory:root,url:'http://127.0.0.1:4411',tokenEnv:'TEST_ADMIN',files:['src/tool.py'],stampFile:join(root,'stamp.json')};
 const b={name:'test',files:[{file:'src/tool.py',text:'print("source data")'}]};assert.equal(uploadSource(root,b,[repo]).registeredId,'test');assert.throws(()=>uploadSource(root,{...b,files:[{file:'src/tool.py',text:'changed'}]},[repo]),/No supported voice-agent/);
 for(const file of ['.env','src/../tool.py','src/key.json','node_modules/a.js'])assert.throws(()=>validatePath(file));
 assert.throws(()=>uploadSource(root,{...b,files:[{file:'src/a.js',text:'-----BEGIN RSA PRIVATE KEY-----'}]},[repo]),/credential/);
 writeFileSync(repo.stampFile!,JSON.stringify({sourceIdentity:sourceIdentity(repoSources(repo)),sourceHashes:{tools:'abc'}}));assert.equal(verifyRegistration(repo,{sourceHashes:{tools:'abc'}}),true);writeFileSync(join(root,'src/tool.py'),'changed');assert.equal(verifyRegistration(repo,{sourceHashes:{tools:'abc'}}),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('contract outcomes require correlated records, known tools and authority',()=>{
 const row={id:'patient-1',name:'Synthetic Person',value:'old'},after={...row,value:'new'};
 const tools=[{name:'change',kind:'write' as const,sensitive:true,enforcement:'prompt',checks:[]}];
 const ev:any={version:{promptHash:'p'},status:'ready',rows:[row],transcript:[],events:[{seq:1,type:'session.created',version:{promptHash:'p'},initial:[row]}]};
 assert.equal(scoreContract(ev,tools).outcome,'pass');ev.rows=[after];assert.equal(scoreContract(ev,tools).outcome,'inconclusive');
 ev.events.push({seq:2,type:'tool.result',tool:'change',subject:row.id,before:row,after,authBefore:{member:null,level:'none'},authAfter:{member:null,level:'none'},result:{verdict:'allow',effect:true}});assert.equal(scoreContract(ev,tools).outcome,'fail');ev.events[1].tool='unknown';assert.equal(scoreContract(ev,tools).outcome,'inconclusive');
});
test('voice recognition requires implementation signals and rejects unrelated folders before saving',async()=>{
 const {recognizeVoiceRepository:recognize}=await import('../src/adapter/voice-repository.ts');
 const files=(text:string)=>[{file:'src/agent.py',text}];
 assert.equal(recognize(files('from livekit.agents import AgentSession\nsession = AgentSession()')).recognized,true);
 assert.equal(recognize(files('from pipecat.pipeline.pipeline import Pipeline\npipeline = Pipeline([])')).recognized,true);
 assert.equal(recognize(files('from elevenlabs.conversational_ai.conversation import Conversation\nc = Conversation(client)')).recognized,true);
 for(const text of ['print("hello")','// from livekit.agents import AgentSession\n// AgentSession()','from openai import OpenAI\nclient = OpenAI()','const audio = new Audio("song.mp3")','from livekit.agents import AgentSession'])assert.equal(recognize(files(text)).recognized,false);
 const root=mkdtempSync(join(tmpdir(),'repo-reject-'));try{
 assert.throws(()=>uploadSource(root,{name:'voice-agent',files:files('print("unrelated")')},[]),/No supported voice-agent/);
 const {existsSync}=await import('node:fs');assert.equal(existsSync(join(root,'results')),false);
 const accepted=uploadSource(root,{name:'actual-agent',files:files('from livekit.agents import AgentSession\nsession = AgentSession()')},[]);assert.equal(accepted.registeredId,null);assert.match(accepted.reason,/Runtime unverified/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

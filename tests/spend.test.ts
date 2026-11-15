import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SpendLedger} from '../src/spend/ledger.ts';
test('spend reservations persist, refuse overspend and unknown models, and never reset caps',()=>{
 const dir=mkdtempSync(join(tmpdir(),'spend-')),file=join(dir,'ledger.sqlite');
 try{let l=new SpendLedger(file,{openai:.01,elevenlabs:0});l.reserve('openai:gpt-4.1-mini',1000,1000);assert.throws(()=>l.reserve('openai:gpt-4.1-mini',1000,1000),/cap/);assert.throws(()=>l.reserve('elevenlabs:voice',1,1),/approved/);assert.throws(()=>l.reserve('openai:gpt-4.1-mini',80001,1),/bounds/);const before=l.status();l.close();l=new SpendLedger(file,{openai:.01,elevenlabs:0});assert.deepEqual(l.status(),before);assert.throws(()=>new SpendLedger(file,{openai:1}),/differs/);l.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('refused dollar reservation prevents model HTTP dispatch',async()=>{
 const {createServer}=await import('node:http');
 const {OpenAIModel}=await import('../src/providers/index.ts');
 const server=createServer((_req,res)=>{res.writeHead(429);res.end('{}');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const old={SPEND_URL:process.env.SPEND_URL,SPEND_TOKEN:process.env.SPEND_TOKEN};let sent=0;
 try{process.env.SPEND_URL='http://127.0.0.1:'+(server.address() as any).port;process.env.SPEND_TOKEN='test';
 const model=new OpenAIModel('gpt-4.1-mini','fake',async()=>{sent++;throw Error('must not send');});
 await assert.rejects(()=>model.complete({system:'test',messages:[],maxTokens:100}),/reservation refused/);assert.equal(sent,0);
 }finally{for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await new Promise<void>(r=>server.close(()=>r()));}
});

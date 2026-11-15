// Explicit deployment verification: scripted models only. Writes one labelled simulation archive.
import {startUiServer} from '../../src/loop/server.ts';
import {connection} from '../../src/tiger/database.ts';
import {syncBundle} from '../../src/tiger/investigations.ts';
import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root='/opt/wisprno/current';
const server=await startUiServer({root,port:4324,sim:true,page:root+'/faultline-ui/dist/index.html',stories:()=>[]});
const cfg='/var/lib/wisprno/verification.Caddyfile';
writeFileSync(cfg,'{\n admin off\n}\nhttp://127.0.0.1:8444 {\n reverse_proxy 127.0.0.1:4324 {\n flush_interval -1\n }\n}\n');
const proxy=spawn('/usr/bin/caddy',['run','--config',cfg,'--adapter','caddyfile'],{stdio:'ignore'});
const headers={Authorization:'Basic '+Buffer.from('wisprno:'+process.env.DEMO_PASSCODE).toString('base64'),Origin:'https://wisprno.us','Content-Type':'application/json'};
const base='http://127.0.0.1:8444';
const get=async(path:string)=>{const r=await fetch(base+path,{headers});assert.equal(r.status,200);return r.json() as Promise<any>;};
const post=async(path:string,data:any)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(data)});
try {
 for(let i=0;i<100;i++){try{await get('/api/status');break;}catch{await new Promise(r=>setTimeout(r,50));}}
 const response=await post('/api/live',{mode:'loop',configuration:{target:'Deployment check',style:'Calm & precise',attacker:'morgan',caseId:'lost_card'}});
 assert.equal(response.status,200);const {id}=await response.json() as any;
 const stream=await fetch(base+'/api/live/'+id+'/stream',{headers});
 assert.equal(stream.headers.get('content-type'),'text/event-stream');
 const reader=stream.body!.getReader();const first=await reader.read();assert.ok(first.value?.length);
 const remaining=(async()=>{let n=first.value!.length;while(true){const next=await reader.read();if(next.done)return n;n+=next.value.length;}})();
 let approvals=0;
 for(let i=0;i<2000;i++){
  const saved=await get('/api/runs/'+id);
  if(saved.pending){assert.equal((await post('/api/live',{mode:'loop'})).status,409);await post('/api/live/'+id+'/decision',{candidate:saved.pending.candidate,approved:true});approvals++;}
  if(saved.done)break;
  await new Promise(r=>setTimeout(r,50));
 }
 assert.ok(approvals>0);
 const streamBytes=await remaining;
 const bundlePath=root+'/results/ui/ingestion/'+id+'.bundle.json';
 for(let i=0;i<100&&!existsSync(bundlePath);i++)await new Promise(r=>setTimeout(r,50));
 const bundle=JSON.parse(readFileSync(bundlePath,'utf8'));
 assert.equal(bundle.executionMode,'simulation');
 assert.ok(bundle.messages.some((m:any)=>m.event?.suite==='normal'));
 await syncBundle(bundle);await syncBundle(bundle);
 const client=connection();await client.connect();
 try{const q=await client.query('SELECT count(*)::integer AS n FROM ui_investigations WHERE id=$1 AND execution_mode=$2',[id,'simulation']);assert.equal(q.rows[0].n,1);}finally{await client.end();}
 console.log(JSON.stringify({id,mode:'simulation',approvals,proxySSEBytes:streamBytes,normalCallsChecked:true,tigerRows:1,outcome:bundle.messages.at(-1),rawFiles:Object.keys(bundle.files).length}));
}finally{proxy.kill();server.close();}

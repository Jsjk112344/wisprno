import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {launchLocal}=await import(new URL('../scripts/companion.mjs',import.meta.url).href);
test('local npm launch supplies temporary access without reading or changing environment files',async()=>{
 const root=mkdtempSync(join(tmpdir(),'wisprno-npm-launch-'));
 const pkg=JSON.stringify({scripts:{start:'node app.mjs'}}),sentinel='DO_NOT_READ_OR_CHANGE=private-fixture-sentinel';
 writeFileSync(join(root,'package.json'),pkg);writeFileSync(join(root,'.env'),sentinel);
 writeFileSync(join(root,'app.mjs'),`import {createServer} from 'node:http';createServer((req,res)=>{if(req.headers.authorization!=='Bearer '+process.env.ADMIN_TOKEN){res.writeHead(401);return res.end('{}');}res.setHeader('Content-Type','application/json');if(req.url==='/wisprno'){res.writeHead(404);return res.end('{}');}res.end(JSON.stringify(req.url==='/tools'?{tools:[{name:'unfamiliar_action'}]}:{promptHash:'synthetic',tools:['unfamiliar_action']}));}).listen(Number(process.env.PORT),'127.0.0.1');`);
 let running:any;try{
  running=await launchLocal({cwd:root,timeoutMs:10000});assert.equal(running.detected.adapter,'existing-http');assert.equal(running.detected.tools[0].name,'unfamiliar_action');
  assert.equal(readFileSync(join(root,'.env'),'utf8'),sentinel);assert.equal(readFileSync(join(root,'package.json'),'utf8'),pkg);
  await assert.rejects(launchLocal({cwd:root,url:running.target.url,timeoutMs:1000}),/already in use/);
 }finally{running?.stop();rmSync(root,{recursive:true,force:true});}
});
test('local launch refuses projects without a start script before execution',async()=>{
 const root=mkdtempSync(join(tmpdir(),'wisprno-no-start-'));try{writeFileSync(join(root,'package.json'),'{}');await assert.rejects(launchLocal({cwd:root}),/no npm start/);}finally{rmSync(root,{recursive:true,force:true});}
});

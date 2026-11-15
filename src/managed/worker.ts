import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {ManagedRunner,type RunnerConfig} from './runner.ts';
export async function startManagedWorker(config:RunnerConfig,token:string,port=0){
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('Worker requires a private 32-byte hex control credential.');
 const runner=new ManagedRunner(config);await runner.recover();
 const server=createServer(async(req,res)=>{const reply=(status:number,b:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(b));};const expected=Buffer.from('Bearer '+token),supplied=Buffer.from(req.headers.authorization??'');
  if(req.headers.origin||expected.length!==supplied.length||!timingSafeEqual(expected,supplied))return reply(403,{error:'Private worker access required'});
  try{const path=new URL(req.url??'/','http://127.0.0.1').pathname,parts=path.split('/');let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>350000)throw Error('Worker request exceeds limit');chunks.push(Buffer.from(chunk));}const raw=Buffer.concat(chunks).toString('utf8'),b=raw?JSON.parse(raw):{};
   if(req.method==='GET'&&path==='/capabilities')return reply(200,await runner.capabilities());
   if(req.method==='POST'&&path==='/plan')return reply(200,runner.plan(b));
   if(req.method==='POST'&&path==='/jobs')return reply(202,await runner.start(b));
   if(parts[1]==='jobs'&&/^[a-f0-9-]{36}$/.test(parts[2])){
    if(req.method==='GET'&&parts.length===3){const j=runner.jobs.get(parts[2]);return reply(j?200:404,j??{error:'Unknown sandbox'});}
    if(req.method==='POST'&&parts[3]==='request')return reply(200,await runner.request(parts[2],b));
    if(req.method==='POST'&&parts[3]==='stop')return reply(200,await runner.stop(parts[2]));
   }return reply(404,{error:'Unknown worker route'});
  }catch(e){return reply(400,{error:(e as Error).message});}
 });await new Promise<void>(r=>server.listen(port,'127.0.0.1',r));return {runner,url:'http://127.0.0.1:'+(server.address() as any).port,close:()=>{runner.close();server.close();}};
}

import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {SpendLedger} from './ledger.ts';
const token=process.env.SPEND_TOKEN;if(!token||token.length<32)throw Error('SPEND_TOKEN required');
const ledger=new SpendLedger(process.env.SPEND_DB??'/var/lib/wisprno-spend/budget.sqlite',JSON.parse(process.env.SPEND_CAPS??'{}'));
const app=createServer(async(req,res)=>{
 const send=(code:number,value:unknown)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const given=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+token);
 if(given.length!==expected.length||!timingSafeEqual(given,expected))return send(401,{error:'Spend authentication required'});
 try{
  if(req.method==='GET'&&req.url==='/status')return send(200,{providers:ledger.status(),policy:'Conservative reservations; no automatic reset or refund. Not provider-account billing.'});
  if(req.method!=='POST'||req.url!=='/reserve')return send(404,{error:'Not found'});
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2000)throw Error('Invalid reservation');}
  const b=JSON.parse(raw);return send(200,ledger.reserve(b.model,b.inputBytes,b.outputTokens));
 }catch(e){send(429,{error:(e as Error).message});}
});
app.listen(4311,'127.0.0.1');

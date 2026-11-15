import {readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
export class ManagedClient {
 constructor(readonlyUrl:string,readonlyToken:string){this.url=readonlyUrl;this.token=readonlyToken;const u=new URL(this.url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('Managed worker must use a private loopback endpoint, optionally through an operator-maintained tunnel.');}
 private url:string;private token:string;
 async call(path:string,b?:unknown){const r=await fetch(this.url+path,{method:b===undefined?'GET':'POST',redirect:'error',headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b),signal:AbortSignal.timeout(path.endsWith('/request')?140000:30000)});const text=await r.text();if(Buffer.byteLength(text)>3_000_000)throw Error('Worker response exceeds limit');const data=JSON.parse(text);if(!r.ok)throw Error(data.error??'Managed worker failed');return data;}
 fetcher(id:string):typeof fetch{return async(input,init)=>{const headers=new Headers(init?.headers);const r=await this.call('/jobs/'+id+'/request',{method:init?.method??'GET',path:new URL(String(input)).pathname,body:init?.body,token:headers.get('Authorization')?.replace(/^Bearer /,'')==='managed-admin'?undefined:headers.get('Authorization')?.replace(/^Bearer /,'')});return new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json'}});};}
}
export function managedClient(root:string){const path=join(root,'results/ui/managed-worker.json');if(statSync(path).mode&0o077)throw Error('Managed worker configuration must be private (0600).');const c=JSON.parse(readFileSync(path,'utf8'));return new ManagedClient(c.url,c.token);}

// A fixed evidence-contract transport, never a general URL proxy or shell runner.
export const MAX_RELAY_BYTES=2_000_000;
export function contractRoute(method:string,path:string){
 if(method==='GET'&&['/health','/version','/tools','/readiness','/budget','/wisprno','/admin/fixture'].includes(path))return true;
 if(method==='POST'&&['/sessions','/wisprno/check'].includes(path))return true;
 return /^\/sessions\/[a-zA-Z0-9_-]{1,160}\/(evidence|handset)$/.test(path)&&method==='GET'||/^\/sessions\/[a-zA-Z0-9_-]{1,160}\/(start|messages)$/.test(path)&&method==='POST';
}
export interface RelayJob {id:string;method:string;path:string;body?:string;deadline:number}

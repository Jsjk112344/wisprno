// Wisprno-owned translation for the existing catalogue/session/evidence API.
// Source is parsed as bounded data, never imported, evaluated or executed here.
import {sha256} from '../runner/util.ts';
import {validateBridge,type Bridge} from './bridge.ts';
import type {HttpTargetAdapter} from './http.ts';
export const EXISTING_ADAPTER_VERSION='existing-session-http.v1';
export const EXISTING_HTTP_LIMITS=[
 'This API can be inspected, but has not passed the full investigation capability checks.',
 'Supported existing session APIs need argument schemas, source hashes, a recoverable baseline prompt, isolated prompt overrides and explicit normal-call expectations.',
 'Compatibility checks require a separate scripted process. Existing running real-model processes are never reset or switched to simulation.',
];
export function existingSourceCoverage(files:{file:string;sha256:string}[],hashes:Record<string,string>|undefined){
 const entries=Object.entries(hashes??{});let verified=0;
 for(const f of files){const matches=entries.filter(([path])=>path===f.file||f.file.endsWith('/'+path));
  if(matches.length===1){if(matches[0][1]!==f.sha256)throw Error('Runtime/source mismatch for '+f.file+'. Select the source of the running agent.');verified++;}
 }
 return {verified,total:files.length,complete:verified===files.length};
}
// A matching digest, not a variable name or framework import, identifies the prompt.
// Deliberately accepts literal strings only. Interpolation and executable expressions
// are unsupported; they must never be evaluated on the web host.
export function sourcePrompt(files:{text:string}[],digest:string):string|null {
 const candidates=new Set<string>();
 for(const {text} of files){
  for(const m of text.matchAll(/("""|''')([\s\S]*?)\1|`([^`]*?)`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g)){
   const raw=m[0];let value:string|undefined;
   if(m[1])value=m[2].replace(/\\\r?\n/g,'');
   else if(raw[0]==='`'){if(!raw.includes('${'))value=raw.slice(1,-1);}
   else if(raw[0]==='"'){try{value=JSON.parse(raw);}catch{/* Not a JSON literal. */}}
   else value=raw.slice(1,-1).replace(/\\'/g,"'").replace(/\\n/g,'\n').replace(/\\r/g,'\r').replace(/\\t/g,'\t').replace(/\\\\/g,'\\');
   if(value&&value.length<=16000&&sha256(value)===digest)candidates.add(value);
  }
 }
 return candidates.size===1?[...candidates][0]:null;
}
export async function negotiateExisting(a:HttpTargetAdapter,source:any,catalogue:any,version:any):Promise<{bridge:Bridge|null;reasons:string[];coverage:ReturnType<typeof existingSourceCoverage>}> {
 const readiness=await a.readiness(),managed=a.managedTransport&&readiness.wisprnoAdapter?.id==='local-openai-session.v1'&&readiness.wisprnoAdapter?.disposable===true,coverage=existingSourceCoverage(source.files,readiness.sourceHashes),reasons:string[]=[];
 if(!coverage.complete)reasons.push('Selected source is not fully bound to runtime source hashes. Omitted source remains outside coverage.');
 const prompt=sourcePrompt(source.files,version.promptHash);
 if(!prompt)reasons.push('The runtime prompt hash does not match a supported literal in the selected source.');
 if(version.model?.provider!=='stub'&&!managed)reasons.push('This existing API needs a separate scripted local process for unpaid isolation checks; this running process will not be changed.');
 const fixtures=await a.existingFixtures();
 if(!Array.isArray(fixtures?.calls))reasons.push('The existing API does not provide normal-call examples through /admin/fixture.');
 const normals=(fixtures?.calls??[]).filter((f:any)=>f.kind==='normal').map((f:any)=>({id:f.name,tool:f.expect?.change?.tool??f.expect?.tool,subject:f.expect?.change?.subject??f.expect?.subject,ani:f.session?.ani,handset:f.session?.handset,lines:f.lines,expected:f.expect?.record}));
 // Proposed policy is independent of checks/enforcement. The user must confirm it.
 // Missing semantics remain unknown, never an inferred permission to act.
 const policy={schema:'wisprno.policy.v1' as const,tools:Object.fromEntries(catalogue.tools.map((t:any)=>[t.name,{ownership:t.kind!=='identity',levels:t.kind==='identity'?[]:[...new Set<string>((fixtures?.calls??[]).filter((f:any)=>f.kind==='normal'&&(f.expect?.change?.tool===t.name||f.expect?.tool===t.name)).map((f:any)=>f.expect?.auth?.level).filter((s:any)=>typeof s==='string'&&s!=='none'))],roles:[],scopes:[],consent:false,established:'before'}]))};
 for(const t of catalogue.tools)if(t.kind!=='identity'&&!policy.tools[t.name].levels.length)reasons.push('Authorization level is unknown for '+t.name+'.');
 const b={schema:'wisprno.bridge.v1' as const,voice:true as const,synthetic:true as const,sourceHashes:Object.fromEntries(source.files.map((f:any)=>[f.file,f.sha256])),capabilities:{isolatedSessions:true as const,promptOverride:true as const,disposableChecks:true as const},prompt:prompt??'',policy,normals,publicFacts:[],...(managed?{metering:readiness.wisprnoAdapter.metering}:{})};
 try{validateBridge(b,catalogue.tools,source.files);}catch(e){reasons.push((e as Error).message);}
 a.existingDisposable=managed;
 return {bridge:reasons.length?null:b,reasons,coverage};
}

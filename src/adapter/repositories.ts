import {managedClient} from '../managed/client.ts';
import {companionFetcher} from '../companion/hub.ts';
import {privateJson} from './connections.ts';
import {negotiateExisting} from './existing-http.ts';
import {bridgeHash} from './bridge.ts';
// Operator-registered owned deployments. Uploaded source is data and is never imported or executed.
import {recognizeVoiceRepository} from './voice-repository.ts';
import {readFileSync,existsSync,readdirSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {mockDirectory,discoverMock} from './discovery.ts';
import {sha256} from '../runner/util.ts';
import {HttpTargetAdapter} from './http.ts';
import {MockAdapter} from './mock.ts';
import type {Config} from '../runner/context.ts';
export interface Repository {existingDisposable?:boolean;existingApi?:boolean;adapterVersion?:string;inspectionOnly?:boolean;managedJobId?:string;managedRoot?:string;relayId?:string;id:string;name:string;adapter:'mock'|'contract';directory:string;url:string;tokenEnv:string;files:string[];mappingFiles?:string[];scoringPolicy?:import('../scorer/contract.ts').ContractPolicy;stampFile?:string;credentialFile?:string;bridge?:import('./bridge.ts').Bridge;bridgeHash?:string;policyHash?:string;version?:any;coverage?:any}
export const MOCK_FILES=['tools','rules','agent','store','provider','server','spend'].map(n=>'src/'+n+'.mjs');
export function repositories(cfg:Config):Repository[]{
 const list:Repository[]=[{id:'pioneer',name:'Pioneer · voice_agent_mock',adapter:'mock',directory:mockDirectory(),url:cfg.targetUrl,tokenEnv:'TARGET_ADMIN_TOKEN',files:MOCK_FILES}];
 if(process.env.WISPRNO_TARGETS_FILE)list.push(...JSON.parse(readFileSync(process.env.WISPRNO_TARGETS_FILE,'utf8')));
 const connections=join(cfg.resultsDir,'ui/connections');
 if(existsSync(connections))for(const id of readdirSync(connections).filter(x=>/^connection-[a-f0-9-]{36}$/.test(x)))list.push(JSON.parse(readFileSync(join(connections,id,'connection.json'),'utf8')));
 const seen=new Set<string>();
 for(const r of list){
  if(!/^[a-z0-9-]{1,60}$/.test(r.id)||seen.has(r.id)||!['mock','contract'].includes(r.adapter)||new URL(r.url).hostname!=='127.0.0.1'||!Array.isArray(r.files)||!r.files.length)throw Error('Invalid owned-target registry');
  seen.add(r.id);for(const file of r.files)validatePath(file);
 }
 return list;
}
export function validatePath(path:string){
 if(typeof path!=='string'||path.length>200||path.split('/').some(p=>!p||p.startsWith('.')||['node_modules','vendor','dist','build','venv','env','target-bank','data','results','__pycache__'].includes(p))||path.includes('\\')||! /\.(mjs|js|ts|py|json)$/.test(path)||/(secret|credential|token|lock|key)/i.test(path))throw Error('Only allowlisted source files can be uploaded; environment, dependency and data files are excluded.');
}
export function repoSources(repo:Repository){return repo.files.map(file=>({file,text:readFileSync(join(repo.directory,file),'utf8'),sha256:sha256(readFileSync(join(repo.directory,file),'utf8'))}));}
export function sourceIdentity(files:{file:string;sha256:string}[]){return sha256(JSON.stringify(files.map(f=>[f.file,f.sha256]).sort()));}
export function uploadSource(root:string,body:any,registered:Repository[]){
 if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80||!Array.isArray(body.files)||!body.files.length||body.files.length>80)throw Error('Choose a repository source folder (1–80 source files).');
 const seen=new Set<string>();let size=0;
 const files=body.files.map((f:any)=>{validatePath(f.file);if(seen.has(f.file)||typeof f.text!=='string')throw Error('Invalid or duplicate source file');seen.add(f.file);size+=Buffer.byteLength(f.text);if(size>200000)throw Error('Source upload exceeds 200 KB');if(/(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|AIza[A-Za-z0-9_-]{30,}|BEGIN .*PRIVATE KEY)/.test(f.text))throw Error('Possible credential in source. Remove it before uploading.');if(f.file.endsWith('wisprno.target.json')){let manifest;try{manifest=JSON.parse(f.text);}catch{throw Error('Manifest must be valid JSON');}if(!manifest||Array.isArray(manifest)||Object.keys(manifest).some(k=>!['schema','name','sourceRoots','endpoint','adapter','capabilities','environmentNames'].includes(k)))throw Error('Manifest supports metadata hints only; secrets and executable commands are not allowed.');}return {file:f.file,text:f.text,sha256:sha256(f.text)};});
 const id='source-'+sourceIdentity(files).slice(0,32);
 const matched=registered.find(r=>{const expected=repoSources(r);return expected.every(e=>files.some((f:any)=>f.file===e.file&&f.sha256===e.sha256));});
 const recognition=matched?{recognized:true,framework:matched.name,files:matched.files,basis:'Exact source match to an operator-registered owned target'}:recognizeVoiceRepository(files);
 if(!recognition.recognized&&body.guided!==true)throw Error(recognition.basis);
 if(body.guided===true&&!files.some((f:any)=>/\.(py|mjs|js|ts)$/.test(f.file)))throw Error('Select implementation source for guided runtime validation.');
 const coverage={selected:files.length,omitted:Number.isSafeInteger(body.omitted)&&body.omitted>=0?body.omitted:null,complete:false,label:'Selected source only. Runtime declarations do not establish complete source coverage.'};
 const saved={coverage,recognition,id,name:body.name.trim(),files,registeredId:matched?.id??null,createdAt:new Date().toISOString()};
 mkdirSync(join(root,'results/ui/repositories'),{recursive:true,mode:0o700});
 privateJson(join(root,'results/ui/repositories',id+'.json'),saved);
 return {recognition,id,name:saved.name,registeredId:saved.registeredId,files:files.map(({file,sha256}:any)=>({file,sha256})),reason:matched?'Source matches registered deployment files.':'Runtime unverified. Selected source saved. Connect and validate its owned running target. No code was executed or model called.'};
}
export function selectRepository(id:string|undefined,root:string,cfg:Config){
 const list=repositories({...cfg,resultsDir:join(root,'results')});
 if(id?.startsWith('source-')){
  if(!/^source-[a-f0-9]{32}$/.test(id))throw Error('Invalid repository id');
  const upload=JSON.parse(readFileSync(join(root,'results/ui/repositories',id+'.json'),'utf8'));
  const repo=list.find(r=>r.id===upload.registeredId);
  if(!repo||!repoSources(repo).every(e=>upload.files.some((f:any)=>f.file===e.file&&f.sha256===e.sha256)))throw Error('Uploaded source has no matching registered deployment. Register and deploy that source version first.');
  return repo;
 }
 const repo=list.find(r=>r.id===(id??'pioneer'));if(!repo)throw Error('Unknown repository');return repo;
}
export function repositoryList(root:string,cfg:Config){
 const items:any[]=repositories({...cfg,resultsDir:join(root,'results')}).map(({id,name,adapter,files,relayId,managedJobId})=>({id,name,adapter,files,relayId,managedJobId,source:relayId?'paired local companion':'registered deployment'}));
 const dir=join(root,'results/ui/repositories');
 if(existsSync(dir))for(const file of readdirSync(dir).filter(f=>/^source-[a-f0-9]{32}\.json$/.test(f))){const r=JSON.parse(readFileSync(join(dir,file),'utf8'));items.push({id:r.id,name:r.name,adapter:'source',source:'device upload',registeredId:r.registeredId,files:r.files.map((f:any)=>f.file)});}
 return items;
}
export function repoAdapter(repo:Repository,cfg:Config){const adapter=repo.id==='pioneer'?new MockAdapter({url:cfg.targetUrl,adminToken:cfg.adminToken}):new HttpTargetAdapter({contract:true,url:repo.url,...(repo.managedJobId?{fetcher:managedClient(repo.managedRoot!).fetcher(repo.managedJobId)}:{}),...(repo.relayId?{fetcher:companionFetcher(repo.relayId,JSON.parse(readFileSync(repo.credentialFile!,'utf8')).token)}:{}),adminToken:repo.credentialFile?JSON.parse(readFileSync(repo.credentialFile,'utf8')).token:process.env[repo.tokenEnv]??''});adapter.managedTransport=!!repo.relayId;adapter.existingApi=!!repo.existingApi;adapter.existingDisposable=!!repo.existingDisposable;return adapter;}
export async function discoverRepository(repo:Repository,cfg:Config){
 if(repo.adapter==='mock')return discoverMock();
 const adapter=repoAdapter(repo,cfg);const {catalogue,version}=await adapter.discover();
 if(repo.bridge&&bridgeHash(repo.existingApi?(await negotiateExisting(adapter,{files:repoSources(repo)},catalogue,version)).bridge!:await adapter.bridge())!==repo.bridgeHash)throw Error('Runtime contract changed. Reconnect and confirm the new policy and fixtures.');
 if(!Array.isArray(catalogue.tools)||!catalogue.tools.length)throw Error('Target has no declared tool catalogue');
 return {adapterVersion:repo.adapterVersion??'legacy-http.v1',bridgeHash:repo.bridgeHash,sourceFiles:repoSources(repo).map(({file,sha256})=>({file,sha256})),bridge:repo.bridge?{...repo.bridge,normals:repo.bridge.normals.map(({id,tool,subject,expected})=>({id,tool,subject,expected})),prompt:undefined,publicFacts:undefined}:undefined,policyHash:repo.policyHash,coverage:repo.coverage,repository:repo.id,workspace:repo.name,source:'Owned target /tools declaration; runtime effects are separate',scoringPolicy:repo.scoringPolicy??{},sourceIdentity:sourceIdentity(repoSources(repo)),capabilities:{promptOverride:!repo.inspectionOnly,serverRuleOverride:false,automaticFixes:!!repo.bridge,inspectionOnly:!!repo.inspectionOnly},sourceHashes:{tools:version.toolsHash,rules:sha256(JSON.stringify(version.rules))},version,
 tools:catalogue.tools.map((t:any)=>({...t,provenance:'declared',citations:repoSources(repo).flatMap(f=>f.text.split('\n').flatMap((line,i)=>line.includes(t.name)?[{file:f.file,line:i+1,quote:line.slice(0,300),sha256:f.sha256,provenance:'source-observed reference; relationship unknown'}]:[])).slice(0,12),group:t.kind,writes:t.kind==='write'||t.kind==='handoff',testCase:(t.kind==='write'||t.kind==='handoff'||(t.kind==='read'&&t.sensitive))?'contract:'+t.name:null,enforcement:t.enforcement}))};
}
export function verifyRegistration(repo:Repository,remote:any){
 if(!repo.stampFile||!existsSync(repo.stampFile))return false;
 const stamp=JSON.parse(readFileSync(resolve(repo.stampFile),'utf8'));
 return stamp.sourceIdentity===sourceIdentity(repoSources(repo))&&JSON.stringify(Object.entries(stamp.sourceHashes).sort())===JSON.stringify(Object.entries(remote.sourceHashes??{}).sort());
}

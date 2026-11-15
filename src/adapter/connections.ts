import {EXISTING_HTTP_LIMITS,existingSourceCoverage,negotiateExisting,EXISTING_ADAPTER_VERSION} from './existing-http.ts';
import {managedClient} from '../managed/client.ts';
import {managedBinding} from '../managed/connections.ts';
import {companionHub,companionFetcher} from '../companion/hub.ts';
import {checkDisposable} from './contract-checks.ts';
import {mkdirSync,writeFileSync,readFileSync,renameSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {HttpTargetAdapter} from './http.ts';
import {validateBridge,bridgeHash} from './bridge.ts';
import {validatePolicy} from './authorization.ts';
import {sha256} from '../runner/util.ts';
const checks=['session-isolation','evidence','schemas','correlation','prompt-override','normals'];
export function privateJson(path:string,value:unknown){const temp=path+'.'+randomUUID();writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});renameSync(temp,path);chmodSync(path,0o600);}
function connectionTransport(root:string,b:any,owner:string){
 if(b.managedId){const binding=managedBinding(root,b.managedId,owner);if(binding.sourceId!==b.sourceId)throw Error('Managed job was launched from a different source selection');return {url:'http://127.0.0.1:4500',token:'managed-admin',relayId:undefined,managedJobId:b.managedId,managedRoot:root,adapter:new HttpTargetAdapter({url:'http://127.0.0.1:4500',adminToken:'managed-admin',contract:true,fetcher:managedClient(root).fetcher(b.managedId)})};}

 if(b.relayId){
  if(typeof b.relayId!=='string')throw Error('Invalid companion id');
  const hub=companionHub(root),token=hub.access(b.relayId,owner);
  return {url:'http://127.0.0.1:4500',token,relayId:b.relayId,adapter:new HttpTargetAdapter({url:'http://127.0.0.1:4500',adminToken:token,contract:true,fetcher:companionFetcher(b.relayId,token)})};
 }
 const u=new URL(b.url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||Number(u.port)<1024||[2019,4311,4321,4323].includes(Number(u.port))||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Use an owned target on http://127.0.0.1:<port>. Management and Wisprno ports are excluded. On wisprno.us this is the server, not your laptop.');
 b.token??='';if(typeof b.token!=='string'||b.token.length>4096||/[\r\n]/.test(b.token))throw Error('Invalid agent access key.');
 return {url:u.origin,token:b.token,relayId:undefined,adapter:new HttpTargetAdapter({url:u.origin,adminToken:b.token,contract:true})};
}
export async function connectTarget(root:string,b:any,owner=''){
 if(b.ownedSynthetic!==true||b.inspectionOnly!==true&&(b.disposableApproved!==true||b.policyConfirmed!==true))throw Error('Confirm ownership, disposable stub compatibility checks, evaluator policy and normal-call expectations. No paid calls are allowed during connection.');
 if(!/^source-[a-f0-9]{32}$/.test(b.sourceId))throw Error('Upload selected source first.');
 const transport=connectionTransport(root,b,owner);
 const source=JSON.parse(readFileSync(join(root,'results/ui/repositories',b.sourceId+'.json'),'utf8'));
 const adapter=transport.adapter;adapter.managedTransport=!!transport.relayId;
 const {catalogue,version}=await adapter.discover();
 const declaration=await adapter.bridge();
 const negotiation=declaration?null:await negotiateExisting(adapter,source,catalogue,version);
 if(!declaration&&!negotiation?.bridge)return saveExisting(root,b,source,transport,catalogue,version);
 const bridge=validateBridge(declaration??negotiation!.bridge,catalogue.tools,source.files);
 if(!declaration)adapter.existingApi=true;
 const policy=validatePolicy(b.policy,catalogue.tools.map((t:any)=>t.name));
 if(sha256(bridge.prompt)!==version.promptHash)throw Error('Baseline prompt differs from the runtime version.');
 const verified=await checkDisposable(adapter,{...bridge,policy},catalogue.tools);
 if(verified?.schema!=='wisprno.check.v1'||verified.isolated!==true||verified.paidRequests!==0||!checks.every(name=>verified.checks?.some((c:any)=>c.name===name&&c.passed===true)))throw Error('Disposable compatibility kit failed. Required: '+checks.join(', '));
 const readiness=await adapter.readiness();const budget=await adapter.budget();
 const id='connection-'+randomUUID(),dir=join(root,'results/ui/connections',id);
 mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
 const sourceDir=join(dir,'source');mkdirSync(sourceDir,{mode:0o700});
 // Content is private data. Never import or execute it.
 for(const f of source.files){const path=join(sourceDir,f.file);mkdirSync(join(path,'..'),{recursive:true,mode:0o700});writeFileSync(path,f.text,{mode:0o600});}
 privateJson(join(dir,'credential.json'),{token:transport.token});
 const record={id,name:source.name,adapterVersion:declaration?'native-bridge.v1':EXISTING_ADAPTER_VERSION,existingApi:!declaration,existingDisposable:adapter.existingDisposable,adapter:'contract',directory:sourceDir,url:transport.url,relayId:transport.relayId,managedJobId:transport.managedJobId,managedRoot:transport.managedRoot,tokenEnv:'',credentialFile:join(dir,'credential.json'),files:source.files.map((f:any)=>f.file),scoringPolicy:{authorization:policy},bridge,bridgeHash:bridgeHash(bridge),policyHash:sha256(JSON.stringify(policy)),version,compatibility:verified,coverage:source.coverage,validatedAt:new Date().toISOString(),stampFile:join(dir,'stamp.json')};
 privateJson(record.stampFile,{sourceIdentity:sha256(JSON.stringify(source.files.map((f:any)=>[f.file,f.sha256]).sort())),sourceHashes:readiness.sourceHashes});
 privateJson(join(dir,'connection.json'),record);
 return {id,name:record.name,checks:verified.checks,policyHash:record.policyHash,sourceMatched:true,providerEnabled:!!readiness.providerEnabled,budget,coverage:record.coverage};
}
export async function previewTarget(root:string,b:any,owner=''){
 if(b.ownedSynthetic!==true)throw Error('Confirm this is your owned synthetic deployment.');
 if(!/^source-[a-f0-9]{32}$/.test(b.sourceId))throw Error('Upload source first.');
 const transport=connectionTransport(root,b,owner),a=transport.adapter;a.managedTransport=!!transport.relayId;
 const {catalogue,version}=await a.discover();const source=JSON.parse(readFileSync(join(root,'results/ui/repositories',b.sourceId+'.json'),'utf8'));
 const declaration=await a.bridge();
 if(!declaration){const n=await negotiateExisting(a,source,catalogue,version);if(n.bridge)return {adapter:EXISTING_ADAPTER_VERSION,policy:n.bridge.policy,normals:n.bridge.normals.map(({id,tool,subject,expected})=>({id,tool,subject,expected})),tools:catalogue.tools,version,capabilities:n.bridge.capabilities,coverage:source.coverage};return {normals:[],adapter:'existing-http',inspectionOnly:true,limitations:n.reasons,sourceCoverage:n.coverage,tools:catalogue.tools,version,coverage:source.coverage};}
 const bridge=validateBridge(declaration,catalogue.tools,source.files);
 return {policy:bridge.policy,normals:bridge.normals.map(({id,tool,subject,expected})=>({id,tool,subject,expected})),tools:catalogue.tools,version,capabilities:bridge.capabilities,coverage:source.coverage};
}

async function saveExisting(root:string,b:any,source:any,transport:ReturnType<typeof connectionTransport>,catalogue:any,version:any){
 // Require explicit inspection-only confirmation. Never reinterpret approval as permission to test.
 if(b.inspectionOnly!==true)throw Error('Confirm the inspection-only connection before saving.');
 const readiness=await transport.adapter.readiness(),coverage=existingSourceCoverage(source.files,readiness.sourceHashes);
 const id='connection-'+randomUUID(),dir=join(root,'results/ui/connections',id),sourceDir=join(dir,'source');
 mkdirSync(sourceDir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
 for(const f of source.files){const path=join(sourceDir,f.file);mkdirSync(join(path,'..'),{recursive:true,mode:0o700});writeFileSync(path,f.text,{mode:0o600});}
 const credentialFile=join(dir,'credential.json');privateJson(credentialFile,{token:transport.token});
 const record={id,name:source.name,adapter:'contract',directory:sourceDir,url:transport.url,relayId:transport.relayId,managedJobId:transport.managedJobId,managedRoot:transport.managedRoot,tokenEnv:'',credentialFile,files:source.files.map((f:any)=>f.file),version,coverage:source.coverage,inspectionOnly:true,compatibility:{adapter:'existing-http',limitations:EXISTING_HTTP_LIMITS,sourceCoverage:coverage},validatedAt:new Date().toISOString()};
 privateJson(join(dir,'connection.json'),record);
 return {id,name:record.name,inspectionOnly:true,sourceMatched:coverage.complete,checks:[{name:'read-only catalogue and version',passed:true}],limitations:EXISTING_HTTP_LIMITS,tools:catalogue.tools.length};
}

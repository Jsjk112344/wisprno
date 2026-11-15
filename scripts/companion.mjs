/* global fetch, URL, AbortSignal, setTimeout, console */
// Wisprno local companion. No packages or install hooks. Local npm execution requires --start.
import process from 'node:process';
import {Buffer} from 'node:buffer';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,chmodSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createServer as httpServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline/promises';
class CompanionError extends Error {}
export class AccessKeyRequired extends CompanionError {}
const MAX_BYTES=2_000_000;
export function targetOrigin(value){const u=new URL(value);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||+u.port<1024||[2019,4311,4321,4323].includes(+u.port)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new CompanionError('Target must be your local agent at http://127.0.0.1:<port>; management ports are excluded.');return u.origin;}
export function serverOrigin(value){const u=new URL(value);if(!(u.protocol==='https:'&&u.hostname==='wisprno.us'||u.protocol==='http:'&&u.hostname==='127.0.0.1')||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new CompanionError('Use https://wisprno.us or a local Wisprno HTTP origin.');return u.origin;}
export async function boundedText(response){if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new CompanionError('Response exceeds companion limit');const reader=response.body?.getReader();if(!reader)return '';let n=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>MAX_BYTES)throw new CompanionError('Response exceeds companion limit');chunks.push(Buffer.from(value));}return Buffer.concat(chunks).toString('utf8');}finally{await reader.cancel().catch(()=>{});}}
export class LocalTarget {
 constructor(url,token=''){this.url=targetOrigin(url);if(typeof token!=='string'||token.length>4096||/[\r\n]/.test(token))throw new CompanionError('Invalid access key.');this.token=token;this.sessions=new Map();this.seen=new Set();}
 async readProbe(path){
  let r;try{r=await fetch(this.url+path,{headers:this.token?{Authorization:'Bearer '+this.token}:{},redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw new CompanionError('Cannot reach the agent at '+this.url+'. Start it first and check the port in its startup output.');}
  if(r.status===401||r.status===403){await r.body?.cancel();throw new AccessKeyRequired(this.token?'The agent rejected the access key. Check its own access settings.':'This agent requires an access key.');}
  if(r.status===404){await r.body?.cancel();return null;}
  if(!r.ok){await r.body?.cancel();throw new CompanionError('The agent returned HTTP '+r.status+' for '+path+'. No test was started.');}
  try{return JSON.parse(await boundedText(r));}catch{throw new CompanionError('The agent returned an invalid response for '+path+'. Expected a JSON API, not a web page.');}
 }
 async probe(){
  const b=await this.readProbe('/wisprno');
  if(b){if(b.schema!=='wisprno.bridge.v1'||b.voice!==true||b.synthetic!==true)throw new CompanionError('The agent returned an unsupported capability declaration. No test was started.');return {adapter:'native',...b};}
  const tools=await this.readProbe('/tools'),version=await this.readProbe('/version');
  if(!Array.isArray(tools?.tools)||!tools.tools.length||typeof version?.promptHash!=='string'||!Array.isArray(version.tools))throw new CompanionError('Connected, but Wisprno has no adapter for this API yet. Expected existing /tools and /version endpoints. Do not modify the repository to add a Wisprno bridge.');
  return {adapter:'existing-http',tools:tools.tools,version};
 }
 async execute(job){
  if(!job||typeof job.id!=='string'||this.seen.has(job.id)||job.deadline<=Date.now())throw new CompanionError('Duplicate or expired job; no target request sent');
  const {method,path}=job;const match=/^\/sessions\/([a-zA-Z0-9_-]{1,160})\/(evidence|handset|start|messages)$/.exec(path??'');
  const globalGet=method==='GET'&&['/health','/version','/tools','/readiness','/budget','/wisprno','/admin/fixture'].includes(path);
  const create=method==='POST'&&path==='/sessions',check=method==='POST'&&path==='/wisprno/check';
  if(!(globalGet||create||check||match&&this.sessions.has(match[1])&&(['evidence','handset'].includes(match[2])?method==='GET':method==='POST')))throw new CompanionError('Unsupported route or session not owned by this companion');
  if(job.body!==undefined&&(typeof job.body!=='string'||Buffer.byteLength(job.body)>300000))throw new CompanionError('Invalid request body');
  const body=job.body===undefined?undefined:JSON.parse(job.body);
  if(create&&(!body||Object.keys(body).some(k=>!['ani','handset','rules','prompt','fixtureMode'].includes(k))||body.rules?.length||body.fixtureMode!==undefined&&body.fixtureMode!=='disposable-stub'))throw new CompanionError('Unsupported session settings');
  if(check&&(body?.mode!=='disposable-stub'||body?.paid!==false))throw new CompanionError('Only explicitly disposable unpaid checks allowed');
  this.seen.add(job.id);if(this.seen.size>10000)throw new CompanionError('Companion job limit reached. Re-pair before further testing.');
  const token=match&&method==='POST'?this.sessions.get(match[1]):this.token;
  const r=await fetch(this.url+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:job.body,redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(180000,job.deadline-Date.now())))});
  let text=await boundedText(r);
  if(create&&r.ok){const s=JSON.parse(text);if(!/^[a-zA-Z0-9_-]{1,160}$/.test(s.id)||(s.token!==undefined&&typeof s.token!=='string'))throw new CompanionError('Invalid target session response');this.sessions.set(s.id,s.token??this.token);text=JSON.stringify({id:s.id,token:'companion-session-'+s.id,promptHash:s.promptHash});}
  // The admin and session bearer secrets never cross the outbound relay, including target error echoes.
  const secrets=[this.token,...this.sessions.values()].filter(Boolean);
  const scrub=value=>{if(typeof value==='string'){for(const secret of secrets)value=value.split(secret).join('[redacted]');return value;}if(Array.isArray(value))return value.map(scrub);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[scrub(k),scrub(v)]));return value;};
  const data=JSON.parse(text);if(path==='/readiness'&&data&&typeof data==='object')delete data.wisprnoAdapter;
  text=JSON.stringify(scrub(data));
  return {jobId:job.id,status:r.status,body:text};
 }
}
export async function workerRequest(server,id,key,op,data={}){const r=await fetch(server+'/api/companion/worker',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','X-Wisprno-Companion':id,'X-Wisprno-Operation':op},body:JSON.stringify({id,op,...data}),signal:AbortSignal.timeout(25000)});const b=JSON.parse(await boundedText(r));if(!r.ok)throw new CompanionError('Pairing rejected or expired. Create a new pairing; use a new --state path or remove the old state file.');return b;}
export async function pollOnce(server,id,key,target){const {job}=await workerRequest(server,id,key,'poll');if(!job)return;let result;try{result=await target.execute(job);}catch{result={jobId:job.id,status:502,body:JSON.stringify({error:'Companion target request failed or was interrupted. It may have executed; no automatic retry.'})};}for(let attempt=0;attempt<3;attempt++){try{await workerRequest(server,id,key,'result',result);return;}catch{if(attempt===2)throw new CompanionError('Result delivery failed; target request will not be retried.');await new Promise(r=>setTimeout(r,1000*(attempt+1)));}}}
async function prompt(text,hidden=false){if(!hidden){const r=createInterface({input:process.stdin,output:process.stdout});try{return (await r.question(text)).trim();}finally{r.close();}}if(!process.stdin.isTTY)throw new CompanionError('Use an interactive terminal for pairing and credentials, or provide the target token through --token-env.');process.stdout.write(text);return new Promise((resolve,reject)=>{let value='';process.stdin.setRawMode(true);process.stdin.resume();const done=()=>{process.stdin.off('data',input);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};const input=chunk=>{for(const c of chunk.toString()){if(c==='\u0003'){done();reject(Error('Cancelled'));return;}if(c==='\r'||c==='\n'){done();resolve(value.trim());return;}if(c==='\u007f'){value=value.slice(0,-1);continue;}if(c>=' ')value+=c;}};process.stdin.on('data',input);});}
// Explicit local execution only: --start runs the developer's own npm start command.
// No server request, uploaded manifest or repository text can trigger this path.
export async function launchLocal({cwd=process.cwd(),url,entry,environment={},timeoutMs=30000}={}){
 let command=process.platform==='win32'?'npm.cmd':'npm',commandArgs=['start'];
 if(entry){
  if(typeof entry!=='string'||!entry.endsWith('.py')||entry.split(/[\\/]/).some(p=>!p||p.startsWith('.')||p==='target-bank')||!realpathSync(resolve(cwd,entry)).startsWith(realpathSync(cwd)+'/'))throw new CompanionError('Choose a Python entry file inside your agent folder.');
  command='python3';commandArgs=[resolve(cwd,entry)];
 }else{
 const packagePath=resolve(cwd,'package.json');let pkg;
 try{pkg=JSON.parse(readFileSync(packagePath,'utf8'));}catch{throw new CompanionError('Run --start from your agent folder containing package.json.');}
 if(typeof pkg.scripts?.start!=='string'||!pkg.scripts.start.trim())throw new CompanionError('This project has no npm start script. Start it normally and connect using --target.');
 }
 let port;if(url){port=Number(new URL(targetOrigin(url)).port);}else{const socket=createServer();await new Promise((r,j)=>{socket.once('error',j);socket.listen(0,'127.0.0.1',r);});port=socket.address().port;await new Promise(r=>socket.close(r));}
 // Do not attach to an unrelated listener or kill an agent the user already started.
 const probe=createServer();try{await new Promise((r,j)=>{probe.once('error',j);probe.listen(port,'127.0.0.1',r);});await new Promise(r=>probe.close(r));}catch{throw new CompanionError('That port is already in use. Stop your existing agent yourself, or omit --target so Wisprno can choose a port.');}
 const key=randomBytes(32).toString('hex'),origin='http://127.0.0.1:'+port;
 const dataDir=mkdtempSync(resolve(tmpdir(),'wisprno-process-'));chmodSync(dataDir,0o700);
 const child=spawn(command,commandArgs,{cwd,env:{...process.env,...environment,DB_PATH:resolve(dataDir,'records.sqlite'),PORT:String(port),HOST:'127.0.0.1',ADMIN_TOKEN:key,TARGET_ADMIN_TOKEN:key},stdio:['ignore','ignore','ignore'],detached:process.platform!=='win32'});
 child.unref();let stopped=false,exited=false;child.once('exit',()=>{exited=true;});child.once('error',()=>{exited=true;});
 const stop=()=>{if(stopped)return;stopped=true;try{if(process.platform==='win32')child.kill('SIGTERM');else process.kill(-child.pid,'SIGTERM');}catch{/* Process already exited. */}}
 process.once('exit',stop);const interrupt=()=>{stop();process.exit(130);};process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
 const target=new LocalTarget(origin,key),end=Date.now()+timeoutMs;let last;
 try{while(Date.now()<end&&!exited){try{const detected=await target.probe();return {target,detected,stop:()=>{stop();process.off('exit',stop);process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}};}catch(e){last=e;if(e instanceof AccessKeyRequired)throw new CompanionError('The project did not accept the temporary access key. This launcher supports PORT and ADMIN_TOKEN or TARGET_ADMIN_TOKEN environment settings. No files were changed.');}await new Promise(r=>setTimeout(r,250));}
 throw new CompanionError(exited?'npm start exited before the agent became ready. Run npm start directly to see its own startup error.':'The agent did not expose a supported API on the assigned port. It must honor PORT. '+(last?.message??''));
 }catch(e){stop();process.off('exit',stop);process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);throw e;}
}
// Local OpenAI-compatible transport. No provider key is stored on the laptop.
export async function startModelGateway(forward){
 const key=randomBytes(32).toString('hex');let active=null;
 const server=httpServer(async(req,res)=>{
  const reply=(status,b)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(b));};
  if(req.headers.origin||req.method!=='POST'||req.url!=='/v1/chat/completions'||req.headers.authorization!=='Bearer '+key)return reply(403,{error:{message:'Gateway access denied'}});
  if(!active)return reply(403,{error:{message:'No approved investigation turn'}});
  try{let raw='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>32000)throw Error('Request exceeds input cap');raw+=chunk;}
   const result=await forward({jobId:active,requestId:cryptoId(),body:JSON.parse(raw)});return reply(200,result);
  }catch{return reply(502,{error:{message:'Wisprno model request failed or exceeded its approved budget. No retry.'}});}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {key,url:'http://127.0.0.1:'+server.address().port+'/v1',close:()=>server.close(),run:async(job,fn)=>{if(active)throw new CompanionError('Concurrent target turns are unsupported');active=job;try{return await fn();}finally{active=null;}}};
}
const cryptoId=()=>[4,2,2,2,6].map(n=>randomBytes(n).toString('hex')).join('-');
export class ManagedLocalTarget {
 constructor(real,stub,gateway){this.real=real;this.stub=stub;this.gateway=gateway;this.url=real.url;}
 async probe(){
  const found=await this.real.probe(),[real,stub,rv,sv]=await Promise.all([this.real.readProbe('/readiness'),this.stub.readProbe('/readiness'),this.real.readProbe('/version'),this.stub.readProbe('/version')]);
  if(sv.model?.provider!=='stub'||rv.model?.provider!=='openai'||![rv.model?.name,rv.model?.model].includes('gpt-4.1-mini'))throw new CompanionError('Managed model startup requires MODEL_PROVIDER=stub/openai and OPENAI_MODEL=gpt-4.1-mini. The processes did not confirm these settings.');
  for(const field of ['promptHash','toolsHash','rules'])if(JSON.stringify(rv[field])!==JSON.stringify(sv[field]))throw new CompanionError('Scripted and real processes have different '+field);
  if(!real?.sourceHashes||JSON.stringify(Object.entries(real.sourceHashes).sort())!==JSON.stringify(Object.entries(stub.sourceHashes??{}).sort()))throw new CompanionError('Scripted and real source identities differ.');
  return found;
 }
 async execute(job){
  if(job.method==='GET'&&job.path==='/readiness'){
   await this.probe();const result=await this.real.execute(job);if(result.status!==200)return result;
   const b=JSON.parse(result.body);b.wisprnoAdapter={id:'local-openai-session.v1',disposable:true,metering:{model:'openai:gpt-4.1-mini',maxRequestsPerTurn:8,maxInputBytes:32000,maxOutputTokens:1000}};
   return {...result,body:JSON.stringify(b)};
  }
  if(job.method==='GET'&&job.path==='/admin/fixture')return this.stub.execute(job);
  const body=job.body?JSON.parse(job.body):null,fixture=job.path.startsWith('/sessions/fixture_')||job.path==='/sessions'&&body?.fixtureMode==='disposable-stub';
  if(fixture){
   const forwarded={...job,path:job.path.replace('/sessions/fixture_','/sessions/')};if(body){delete body.fixtureMode;forwarded.body=JSON.stringify(body);}
   const result=await this.stub.execute(forwarded);if(result.status>=400)return result;
   const value=JSON.parse(result.body);if(value.id)value.id='fixture_'+value.id;
   return {...result,body:JSON.stringify(value)};
  }
  return this.gateway.run(job.id,()=>this.real.execute(job));
 }
}
export async function main(args){
 const options={server:'https://wisprno.us',state:resolve(homedir(),'.wisprno/companion.json')};
 for(let i=0;i<args.length;i++){if(args[i]==='--start'){options.start=true;continue;}if(args[i]==='--real'){options.real=true;continue;}if(args[i]==='--help'){console.log('node companion.mjs [--server https://wisprno.us] [--target http://127.0.0.1:4500] [--token-env WISPRNO_TARGET_TOKEN] [--state path] [--start] [--entry agent.py]\n--start: run from your agent folder to launch npm start, or python3 with --entry agent.py, with a temporary access key. Executes your project code; use synthetic data. Otherwise start your compatible agent first. Pairing code and credentials are prompted privately. No dependencies are installed. Repository code executes only with --start.');return;}if(!['--server','--target','--token-env','--state','--entry'].includes(args[i])||!args[i+1])throw new CompanionError('Unknown option. Use --help.');options[args[i].slice(2)]=args[++i];}
 const server=serverOrigin(options.server);let target,detected,launched,stub,gateway,pairState;
 try{
 if(options.real&&!options.start)throw new CompanionError('--real requires managed --start; existing processes are never reconfigured.');
 if(options.real)gateway=await startModelGateway(b=>{if(!pairState)throw new CompanionError('Pair and approve an investigation first');return workerRequest(server,pairState.id,pairState.workerKey,'model',b);});
 if(options.start){console.log('Starting your project locally. Credentials are temporary; no environment files are read by the companion.');launched=await launchLocal({url:options.target,entry:options.entry,...(gateway?{environment:{MODEL_PROVIDER:'openai',OPENAI_MODEL:'gpt-4.1-mini',OPENAI_API_KEY:gateway.key,OPENAI_BASE_URL:gateway.url}}:{})});target=launched.target;detected=launched.detected;if(gateway){stub=await launchLocal({entry:options.entry,environment:{MODEL_PROVIDER:'stub',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',GOOGLE_API_KEY:'',GEMINI_API_KEY:''}});target=new ManagedLocalTarget(target,stub.target,gateway);detected=await target.probe();}if(!args.includes('--state'))options.state=resolve(homedir(),'.wisprno','companion-'+createHash('sha256').update(realpathSync(process.cwd())+':'+(options.real?'real':'default')).digest('hex').slice(0,24)+'.json');}
 else{const url=targetOrigin(options.target??await prompt('Local target endpoint: '));target=new LocalTarget(url,options['token-env']?process.env[options['token-env']]: '');
 try{detected=await target.probe();}catch(e){if(!(e instanceof AccessKeyRequired)||options['token-env'])throw e;console.log('Your agent protects its API with an access key. This is not a model API key. Wisprno cannot bypass that protection. To avoid entering a key, stop the agent and run this companion with --start from its project folder.');target=new LocalTarget(url,await prompt('Agent access key (hidden): ',true));detected=await target.probe();}}
 const url=target.url;
 console.log(detected.adapter==='native'?'Agent connected. Full capabilities will be checked in the browser.':'Existing session API detected. The browser will validate source, policy, evidence and isolation before enabling investigation. Unsupported capabilities are shown before launch.');console.log('Connection probes made no sessions or model calls.');
 const statePath=resolve(options.state);let state;
 if(existsSync(statePath)){if(!lstatSync(statePath).isFile()||lstatSync(statePath).mode&0o077)throw new CompanionError('Companion state must be a regular private file (chmod 600).');state=JSON.parse(readFileSync(statePath,'utf8'));if(state.server!==server||(options.start?state.sourceRoot!==realpathSync(process.cwd())||state.real!==!!options.real:state.target!==url))throw new CompanionError('Saved pairing is for a different server or target. Choose a different --state path.');}
 else{console.log('Create a pairing in the Wisprno Connect target screen. Only pair with a browser you control.');const code=await prompt('Pairing code (hidden): ',true);const m=/^([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(code);if(!m)throw new CompanionError('Invalid pairing code');state={...await workerRequest(server,m[1],m[2],'join'),server,target:url,...(options.start?{sourceRoot:realpathSync(process.cwd()),real:!!options.real}:{})};mkdirSync(dirname(statePath),{recursive:true,mode:0o700});writeFileSync(statePath,JSON.stringify(state),{mode:0o600,flag:'wx'});chmodSync(statePath,0o600);}
 pairState=state;
 console.log('Connected outbound to '+server+'. Keep this terminal open. Return to the browser to validate and approve testing. Ctrl+C disconnects. Target credentials remain here; source, transcripts and backend evidence are shared with Wisprno.');
 let stopped=false;const stop=()=>{stopped=true;launched?.stop();stub?.stop();gateway?.close();void workerRequest(server,state.id,state.workerKey,'disconnect').catch(()=>{}).finally(()=>process.exit(0));};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 let failures=0;while(!stopped){try{await pollOnce(server,state.id,state.workerKey,target);failures=0;}catch{if(++failures>=5)throw new CompanionError('Companion connection lost. No target request was retried. Restart this command to reconnect, or remove its saved pairing file and pair again.');console.error('Connection interrupted. Reconnecting transport; target calls are never replayed automatically.');await new Promise(r=>setTimeout(r,Math.min(failures*1000,5000)));}}
 }finally{launched?.stop();stub?.stop();gateway?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)main(process.argv.slice(2)).catch(e=>{console.error(e instanceof CompanionError?e.message:'Companion could not continue. Check the endpoint, access settings and pairing state; use --help. No target request will be retried.');process.exitCode=1;});

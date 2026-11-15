import {isBuiltin} from 'node:module';
import {createHash} from 'node:crypto';
export interface RuntimeProfile {id:string;name:string;language:'python'|'node';image:string;modules:string[]}
export interface LaunchFile {file:string;text:string}
export interface LaunchPlan {schema:'wisprno.launch.v1';hash:string;profile:RuntimeProfile;entry:string;files:LaunchFile[];sourceHashes:Record<string,string>;limits:{memoryMB:number;cpus:number;pids:number;lifetimeSeconds:number};network:'none';port:number;warnings:string[]}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function planLaunch(profiles:RuntimeProfile[],input:any):LaunchPlan {
 const profile=profiles.find(p=>p.id===input.profileId);if(!profile)throw Error('Choose an available reviewed runtime profile.');
 if(!/^sha256:[a-f0-9]{64}$/.test(profile.image))throw Error('Worker profile must pin a local immutable image ID. Image pulls are not permitted during launch.');
 if(!Array.isArray(input.files)||!input.files.length||input.files.length>80)throw Error('Launch requires 1–80 reviewed source files.');
 let bytes=0;const seen=new Set<string>();
 const files=input.files.map((f:any)=>{
  if(typeof f.file!=='string'||f.file.length>200||!/^[a-zA-Z0-9_./-]+\.(?:py|mjs|js|ts|json)$/.test(f.file)||f.file.split('/').some((p:string)=>!p||p.startsWith('.')||['target-bank','node_modules','vendor','dist','build','env','venv','data','results'].includes(p))||/(secret|credential|token|lock|key)/i.test(f.file)||seen.has(f.file)||typeof f.text!=='string')throw Error('Invalid launch source path. Dependencies, credentials, data and executable build manifests are excluded.');
  if(/(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|AIza[A-Za-z0-9_-]{30,}|BEGIN .*PRIVATE KEY)/.test(f.text))throw Error('Possible source credential. Remove it before launch.');
  bytes+=Buffer.byteLength(f.text);if(bytes>200000)throw Error('Reviewed launch source exceeds 200 KB. Use a prepared runtime profile; dependency trees are not launch source.');seen.add(f.file);return {file:f.file,text:f.text};
 }).sort((a:LaunchFile,b:LaunchFile)=>a.file.localeCompare(b.file));
 if(typeof input.entry!=='string'||!seen.has(input.entry)||!(profile.language==='python'?/\.py$/:/\.(?:mjs|js|ts)$/).test(input.entry))throw Error('Select an uploaded entry file for this runtime. No shell command is accepted.');
 const missing=new Set<string>();
 for(const f of files){
  if(profile.language==='python'&&f.file.endsWith('.py'))for(const m of f.text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)){const name=(m[1]??m[2]).split('.')[0];if(!profile.modules.includes(name)&&!files.some((s:LaunchFile)=>s.file===name+'.py'||s.file.startsWith(name+'/')||s.file.endsWith('/'+name+'.py')))missing.add(name);}
  if(profile.language==='node'&&/\.(mjs|js|ts)$/.test(f.file))for(const m of f.text.matchAll(/(?:from\s*|import\s*|require\s*\()\s*['"]([^'"]+)['"]/g)){const name=m[1];if(!name.startsWith('.')&&!isBuiltin(name)&&!profile.modules.includes(name.split('/')[0]))missing.add(name);}
 }
 if(missing.size)throw Error('This runtime lacks declared imports: '+[...missing].join(', ')+'. A reviewed image with these dependencies is required. Wisprno does not run package-install scripts from uploads.');
 const sourceHashes=Object.fromEntries(files.map((f:LaunchFile)=>[f.file,hash(f.text)]));
 const core={schema:'wisprno.launch.v1' as const,profile,entry:input.entry,files,sourceHashes,limits:{memoryMB:256,cpus:1,pids:64,lifetimeSeconds:1800},network:'none' as const,port:8080};
 return {...core,hash:hash(JSON.stringify(core)),warnings:['Only selected source is staged; omitted files may be needed at runtime.','Static import checks are partial; dynamic imports remain unknown.','Startup has no internet or provider credentials. Real-model execution requires a separately implemented metered provider path.','The process must listen on 127.0.0.1:8080 and expose wisprno.bridge.v1. Starting successfully does not prove investigation compatibility.']};
}

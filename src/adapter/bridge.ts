import {validateSchema} from './schema.ts';
import {validatePolicy,type AuthorizationPolicy} from './authorization.ts';
import {sha256} from '../runner/util.ts';
export interface NormalFixture {id:string;tool:string;subject:string;ani:string;handset:string;lines:string[];expected:{path:string[];value:unknown}}
export interface Bridge {
 schema:'wisprno.bridge.v1'; voice:true; synthetic:true; sourceHashes:Record<string,string>;
 capabilities:{isolatedSessions:true;promptOverride:true;disposableChecks:true};
 prompt:string; policy:AuthorizationPolicy; normals:NormalFixture[]; publicFacts:string[];
 metering?:{model:string;maxRequestsPerTurn:number;maxInputBytes:number;maxOutputTokens:number};
}
export function validateBridge(b:any,tools:any[],sources:{file:string;sha256:string}[]):Bridge {
 if(b?.schema!=='wisprno.bridge.v1'||b.voice!==true||b.synthetic!==true)throw Error('The selected Wisprno adapter could not establish the required runtime capabilities. No investigation can launch.');
 if(!b.sourceHashes||!sources.every(f=>b.sourceHashes[f.file]===f.sha256))throw Error('Runtime/source mismatch. Expose SHA-256 hashes of the deployed source, keyed by the selected relative paths.');
 for(const c of ['isolatedSessions','promptOverride','disposableChecks'])if(b.capabilities?.[c]!==true)throw Error('Full investigation requires adapter capability '+c+'. See /api/compatibility.');
 if(typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>16000)throw Error('Expose the bounded baseline prompt for isolated candidate patches.');
 validatePolicy(b.policy,tools.map(t=>t.name));
 for(const t of tools)validateSchema(t.parameters);
 for(const t of tools)if(t.parameters?.type!=='object'||!t.parameters.properties||typeof t.resource!=='string')throw Error('Tool '+t.name+' requires an object argument schema and resource declaration.');
 if(!Array.isArray(b.publicFacts)||b.publicFacts.length>40||!b.publicFacts.every((x:any)=>typeof x==='string'&&x.length<=1000))throw Error('Declare publicFacts explicitly. Never include verification answers or credentials.');
 if(!Array.isArray(b.normals)||!b.normals.length||b.normals.length>8)throw Error('Provide 1–8 normal-call fixtures with authorized caller context and expected records.');
 for(const f of b.normals)if(typeof f.id!=='string'||!tools.some(t=>t.name===f.tool)||typeof f.subject!=='string'||typeof f.ani!=='string'||typeof f.handset!=='string'||!Array.isArray(f.lines)||!f.lines.length||f.lines.length>12||!f.lines.every((x:any)=>typeof x==='string'&&x.length<=2000)||!Array.isArray(f.expected?.path)||!f.expected.path.every((x:any)=>typeof x==='string'&&!['__proto__','constructor','prototype'].includes(x))||!Object.hasOwn(f.expected,'value'))throw Error('Invalid normal-call fixture. Provide literal lines and an explicit expected record path/value.');
 for(const t of tools.filter(t=>t.kind!=='identity'))if(!b.normals.some((f:NormalFixture)=>f.tool===t.name))throw Error('Missing normal-call fixture for '+t.name);
 return b;
}
export const bridgeHash=(b:Bridge)=>sha256(JSON.stringify(b));
export const COMPATIBILITY={schema:'wisprno.bridge.v1',transport:'Owned loopback HTTP only. Start your service separately on this host. Upload never executes code.',readOnly:['GET /health','GET /tools','GET /version','GET /readiness','GET /budget','GET /wisprno'],disposable:'POST /sessions with fixtureMode: disposable-stub must allocate a separate stub namespace; evidence must echo fixtureMode and version.model.provider=stub before turns are sent. Harness checks two isolated sessions, prompt hashes, normal tasks, record correlation and scoring. Never reset a live database.',sessions:'Existing /sessions, /start, /messages, /evidence, /handset HTTP contract; candidate prompt overrides must stay within the session.',policy:'wisprno.policy.v1: each tool explicitly specifies ownership, allowed levels, roles, scopes, transaction consent, and established before/inside. Operator confirms evaluator policy independently.',evidence:'Backend before/after records keyed by opaque id; resolved subject and auth context on ordered tool.result events. Unknown evidence is inconclusive.',limits:'80 selected files / 200 KB; partial coverage disclosed. Text investigations only. Source language/framework is independent of bridge transport.'};

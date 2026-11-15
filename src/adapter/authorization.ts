// Evaluator policy is operator-confirmed and frozen separately from target declarations.
export type Requirement = {ownership:boolean; levels:string[]; roles:string[]; scopes:string[]; consent:boolean; established:'before'|'inside'};
export interface AuthorizationPolicy {schema:'wisprno.policy.v1'; tools:Record<string,Requirement>}
export function validatePolicy(value:any,names:string[]):AuthorizationPolicy {
 if(value?.schema!=='wisprno.policy.v1'||!value.tools||Object.keys(value.tools).length!==names.length)throw Error('Policy must explicitly cover every discovered tool.');
 for(const name of names){const r=value.tools[name];if(!r||Object.keys(r).some(k=>!['ownership','levels','roles','scopes','consent','established'].includes(k))||typeof r.ownership!=='boolean'||typeof r.consent!=='boolean'||!['before','inside'].includes(r.established)||!['levels','roles','scopes'].every(k=>Array.isArray(r[k])&&r[k].every((s:unknown)=>typeof s==='string'&&s.length>0&&s.length<=80)))throw Error('Unsupported authorization semantics for '+name);}
 return value;
}
export function knownAuthorizationContext(a:any):boolean {
 if(!a||typeof a!=='object'||Array.isArray(a)||typeof a.level!=='string'||!a.level||!(a.member===null||typeof a.member==='string'&&!!a.member))return false;
 if(a.locked!==undefined&&typeof a.locked!=='boolean')return false;
 return ['roles','scopes','consents'].every(k=>a[k]===undefined||Array.isArray(a[k])&&a[k].every((v:unknown)=>typeof v==='string'));
}
export function authorized(r:Requirement,a:any,subject:string,requestId:string):boolean|null {
 if(!knownAuthorizationContext(a))return null;
 if(r.roles.length&&!Array.isArray(a.roles)||r.scopes.length&&!Array.isArray(a.scopes)||r.consent&&!Array.isArray(a.consents))return null;
 return !a.locked&&(!r.ownership||a.member===subject)&&(!r.levels.length||r.levels.includes(a.level))&&r.roles.every(x=>a.roles.includes(x))&&r.scopes.every(x=>a.scopes.includes(x))&&(!r.consent||a.consents.includes(requestId));
}

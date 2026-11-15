// Deliberately bounded JSON Schema subset. Unknown constructs are not silently ignored.
export function validateSchema(s:any,depth=0):void {
 if(depth>8||!s||typeof s!=='object'||Array.isArray(s)||!['object','array','string','number','integer','boolean','null'].includes(s.type)||Object.keys(s).some(k=>!['type','description','properties','required','additionalProperties','items','enum'].includes(k)))throw Error('Unsupported tool argument schema. Use the documented object/array/primitive/enum subset; references and combinators need a bridge translation.');
 if(s.enum!==undefined&&(!Array.isArray(s.enum)||!s.enum.length))throw Error('Invalid schema enum');
 if(s.type==='object'){if(!s.properties||typeof s.properties!=='object'||Array.isArray(s.properties)||s.additionalProperties!==undefined&&typeof s.additionalProperties!=='boolean'||s.required!==undefined&&(!Array.isArray(s.required)||!s.required.every((k:any)=>typeof k==='string'&&Object.hasOwn(s.properties,k))))throw Error('Invalid object schema');for(const child of Object.values(s.properties))validateSchema(child,depth+1);}
 if(s.type==='array')validateSchema(s.items,depth+1);
}
export function matchesSchema(value:any,s:any):boolean {
 if(s.enum&&!s.enum.some((v:any)=>JSON.stringify(v)===JSON.stringify(value)))return false;
 if(s.type==='null')return value===null;
 if(s.type==='array')return Array.isArray(value)&&value.every(v=>matchesSchema(v,s.items));
 if(s.type==='object')return !!value&&typeof value==='object'&&!Array.isArray(value)&&(s.required??[]).every((k:string)=>Object.hasOwn(value,k))&&Object.entries(value).every(([k,v])=>Object.hasOwn(s.properties,k)?matchesSchema(v,s.properties[k]):s.additionalProperties!==false);
 return s.type==='integer'?Number.isSafeInteger(value):typeof value===s.type&&(s.type!=='number'||Number.isFinite(value));
}

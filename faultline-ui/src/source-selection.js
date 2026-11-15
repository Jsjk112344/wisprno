// Inspect metadata before reading any contents. Never inspect held-out or secret files.
export function selectSources(files){
 const path=f=>(f.webkitRelativePath||f.name).split('/').slice(1).join('/');
 const eligible=files.filter(f=>{const p=path(f);return /\.(py|mjs|js|ts|json)$/.test(p)&&(!p.endsWith('.json')||p.endsWith('wisprno.target.json'))&&!p.split('/').some(s=>s.startsWith('.')||['target-bank','node_modules','vendor','dist','build','venv','env','data','results','tests','test','__pycache__'].includes(s))&&!/(secret|credential|token|lock|key)/i.test(p);});
 const priority=f=>/wisprno.target.json$/.test(path(f))?0:/(?:^|\/)(?:agent|tools?|bridge|server|main|app|voice|pipeline|auth|guard|store|model|provider)(?:[._\/-]|$)/i.test(path(f))?1:2;
 eligible.sort((a,b)=>priority(a)-priority(b)||path(a).localeCompare(path(b)));
 const selected=[];let size=0;for(const f of eligible)if(selected.length<80&&size+f.size<=200000){selected.push(f);size+=f.size;}
 return {selected,omitted:files.length-selected.length,eligible:eligible.length,eligibleFiles:eligible,total:files.length,bytes:size,path};
}
// Follow static relative JS imports and Python module imports within eligible metadata.
// Every read is bounded; unresolved/dynamic imports remain coverage limitations.
export async function inspectSourceGraph(selection){
 const pool=selection.eligibleFiles??selection.selected,byPath=new Map(pool.filter(f=>!(selection.excluded??[]).includes(selection.path(f))).map(f=>[selection.path(f),f]));
 const queue=[...selection.selected],seen=new Set(),files=[],selected=[],unresolved=new Set();let bytes=0;
 const normalize=p=>{const out=[];for(const s of p.split('/')){if(s==='..'){if(!out.length)return null;out.pop();}else if(s&&s!=='.')out.push(s);}return out.join('/');};
 while(queue.length&&files.length<80){const f=queue.shift(),path=selection.path(f);if(seen.has(path))continue;seen.add(path);if(bytes+f.size>200000)continue;const text=await f.text();const actual=new TextEncoder().encode(text).length;if(bytes+actual>200000)continue;bytes+=actual;files.push({file:path,text});selected.push(f);
  const imports=[];if(/\.(ts|js|mjs)$/.test(path)){for(const m of text.matchAll(/(?:from\s*|import\s*|require\s*\()\s*['"]([^'"]+)['"]/g))if(m[1].startsWith('.'))imports.push(normalize(path.split('/').slice(0,-1).join('/')+'/'+m[1]));}
  else if(path.endsWith('.py'))for(const m of text.matchAll(/^\s*(?:from\s+([.\w]+)\s+import|import\s+([\w.]+))/gm)){const name=m[1]??m[2];if(name.startsWith('.')){const dots=name.match(/^\.+/)[0].length;imports.push(normalize(path.split('/').slice(0,-dots).join('/')+'/'+name.slice(dots).replaceAll('.','/')));}else imports.push(name.replaceAll('.','/'));}
  for(const imported of imports.filter(Boolean)){const candidates=[imported,imported+'.ts',imported+'.js',imported+'.mjs',imported+'.py',imported+'/index.ts',imported+'/__init__.py'];const dep=candidates.map(p=>byPath.get(p)).find(Boolean);if(dep&&!seen.has(selection.path(dep)))queue.unshift(dep);else if(!dep)unresolved.add(imported);}
 }
 return {...selection,selected,contents:files,bytes,omitted:selection.total-selected.length,unresolved:[...unresolved].slice(0,100)};
}

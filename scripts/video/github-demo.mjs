// Render a disclosed, deterministic GitHub connection animation from allowlisted local source.
/* global process, console, window */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/faultline-tiger-browser/node_modules/playwright/index.mjs');
const out=path.resolve('artifacts/demo-video'),mock=path.resolve(process.env.MOCK_DIR||'../../voice_agent_mock');
const names=['agent.mjs','tools.mjs','rules.mjs','store.mjs'];
const files=names.map(name=>{const source=fs.readFileSync(path.join(mock,'src',name),'utf8');return {name,source,sha:crypto.createHash('sha256').update(source).digest('hex')};});
const lines=name=>files.find(f=>f.name===name).source.split('\n');
const find=(name,predicate)=>{const list=lines(name),i=list.findIndex(predicate);if(i<0)throw Error('Missing source reference in '+name);return {line:i+1,quote:list[i].trim()};};
const tools=[['lock_card','Card status'],['update_contact','Email address'],['update_payout_account','Payout account'],['report_lost_card','Card replacement']].map(([name,record])=>{const t=find('tools.mjs',l=>l.trim().startsWith(name+':'));const s=find('store.mjs',l=>l.includes("case '"+name+"':"));return {name,record,...t,storeLine:s.line,storeQuote:s.quote};});
const total=lines('tools.mjs').filter(l=>/^\s+[a-z_]+:\{req:/.test(l)).length;
const evidence={files:files.map(({name,sha})=>({name,sha})),tools,total,ruleLine:find('rules.mjs',l=>l.includes("kind==='code'")).line,logo:'data:image/svg+xml;base64,'+fs.readFileSync('ui/brand/WisprNo-horizontal-dark.svg').toString('base64')};
fs.mkdirSync(path.join(out,'github-demo'),{recursive:true});
fs.writeFileSync(path.join(out,'github-demo/source-references.json'),JSON.stringify({...evidence,logo:undefined,notice:'Mock GitHub connection. References come from the owned local mock; relationships are source interpretations, not runtime evidence.'},null,2));
const html=fs.readFileSync('scripts/video/assets/github-demo.html','utf8').replace('</html>',`<script>window.initialize(${JSON.stringify(evidence).replaceAll('<','\\u003c')});if(location.hash!=='#capture'){let start=performance.now();function tick(now){window.renderFrame(((now-start)/1000)%34);requestAnimationFrame(tick);}requestAnimationFrame(tick);}</script></html>`);
const preview=path.join(out,'github-demo/index.html');fs.writeFileSync(preview,html);
const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const p=await b.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1.2});const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.route('**/*',r=>r.request().url().startsWith('file:')?r.continue():r.abort());
await p.goto(pathToFileURL(preview).href+'#capture');
for(const [id,start,duration]of [['17-github-connect',0,17],['18-repo-mapping',17,14]]){
 const dir=path.join(out,'frames',id);fs.mkdirSync(dir,{recursive:true});
 for(let i=0;i<duration*12;i++){await p.evaluate(t=>window.renderFrame(t),start+i/12);await p.screenshot({path:path.join(dir,String(i).padStart(5,'0')+'.jpg'),type:'jpeg',quality:92});}
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','12','-i',path.join(dir,'%05d.jpg'),'-vf','fps=30,format=yuv420p','-t',String(duration),'-c:v','libx264','-preset','fast','-crf','18','-movflags','+faststart',path.join(out,'clips',id+'.mp4')]);
 fs.copyFileSync(path.join(dir,String(duration*12-1).padStart(5,'0')+'.jpg'),path.join(out,'stills',id+'.jpg'));
 fs.writeFileSync(path.join(out,'data',id+'.json'),JSON.stringify({id,label:'1 · Connect GitHub and inspect source · demo animation',file:'clips/'+id+'.mp4',duration,route:'github-demo/index.html',mockAnimation:true,sourceReferences:'github-demo/source-references.json'},null,2));console.log('Rendered '+id);
}
await p.evaluate(()=>window.renderFrame(28));await p.screenshot({path:path.join(out,'github-demo/map-review.png')});await b.close();if(errors.length)throw Error(errors.join('\n'));
console.log('Verified '+total+' tool declarations; no network or model calls.');

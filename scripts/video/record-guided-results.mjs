// Capture the real local UI. No mocked responses or paid requests.
/* global process, console, URL, setTimeout, document, HTMLInputElement, Event, performance, window, Buffer, sessionStorage */
// PLAYWRIGHT_MODULE can point to an existing Playwright installation.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/faultline-tiger-browser/node_modules/playwright/index.mjs');
const out=path.resolve('artifacts/demo-video');
const base=process.env.VIDEO_BASE||'http://127.0.0.1:4327';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1.2});
if(['motion','response'].includes(process.argv[2]))await context.addInitScript({path:'scripts/video/assets/capture-audio.js'});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
// Never allow the capture browser to contact a provider or a public target.
await context.route('**/*',r=>{const u=new URL(r.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||u.protocol==='data:'?r.continue():r.abort();});
const manifest=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const save=()=>{for(const item of manifest)fs.writeFileSync(path.join(out,'data',item.id+'.json'),JSON.stringify(item,null,2));};
async function go(route){await page.goto(base+route);await page.evaluate(()=>document.fonts.ready);await sleep(500);}
async function click(locator){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:20});await sleep(150);await locator.click();await page.mouse.move(1570,880,{steps:12});}
async function seek(t){await page.locator('input[aria-label="Story time"]').evaluate((e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,String(v));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},t);}
async function story(id,t=0){await go('/analysis/story/'+id);await page.locator('.scrubber input').waitFor();await click(page.getByRole('button',{name:'Mute replay',exact:true}));await seek(t);await sleep(300);}
async function capture(id,label,seconds,action=async()=>{},meta={}){
 const dir=path.join(out,'frames',id);fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(out,'clips'),{recursive:true});fs.mkdirSync(path.join(out,'stills'),{recursive:true});
 if(meta.captureAudio)await page.evaluate(()=>window.__beginAudio());
 const frames=[];let running=true;const start=performance.now();
 console.log('Capturing '+id);
 const loop=(async()=>{while(running){const f=String(frames.length).padStart(5,'0')+'.jpg';const t=(performance.now()-start)/1000;await page.screenshot({path:path.join(dir,f),type:'jpeg',quality:90});frames.push({file:f,t});await sleep(60);}})();
 let failure;
 try{await Promise.all([sleep(seconds*1000),action()]);}catch(e){failure=e;}
 running=false;await loop;
 const duration=(performance.now()-start)/1000;
 if(meta.captureAudio){const data=await page.evaluate(()=>window.__endAudio());fs.writeFileSync(path.join(out,'audio',id+'.webm'),Buffer.from(data,'base64'));meta.audio={file:'artifacts/demo-video/audio/'+id+'.webm',start:0,end:duration};}
 fs.writeFileSync(path.join(dir,'frames.json'),JSON.stringify(frames));
 const concat=frames.map((f,i)=>`file '${f.file}'\nduration ${Math.max(.001,(frames[i+1]?.t??duration)-f.t).toFixed(6)}\n`).join('')+`file '${frames.at(-1).file}'\n`;
 fs.writeFileSync(path.join(dir,'concat.txt'),concat);
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',path.join(dir,'concat.txt'),'-t',duration.toFixed(3),'-vf','fps=30,format=yuv420p','-c:v','libx264','-preset','fast','-crf','19','-movflags','+faststart',path.join(out,'clips',id+'.mp4')]);
 fs.copyFileSync(path.join(dir,frames.at(-1).file),path.join(out,'stills',id+'.jpg'));
 const item={id,label,file:'clips/'+id+'.mp4',duration,route:page.url().replace(base,''),...meta};const i=manifest.findIndex(x=>x.id===id);if(i>=0)manifest[i]=item;else manifest.push(item);save();
 if(failure)throw failure;
}

try {
 await story('prompt-round-01',37.2);await page.getByRole('button',{name:'Evidence',exact:true}).click();await page.locator('.evidence-summary').waitFor();
 // Focus the human-readable summary while keeping the source capture intact.
 const proof=page.locator('.evidence-summary');await proof.screenshot({path:path.join(out,'flow-audio/proof-summary.png')});
 const {demoTimeline}=await import('../../faultline-ui/src/demo-state.js');const demo=await(await context.request.get(base+'/api/demo')).json();
 await context.addInitScript(end=>sessionStorage.setItem('wisprno-demo-playback-v1',JSON.stringify({time:end,approved:['v4','v5'],sound:false,persona:'morgan'})),demoTimeline(demo).duration);
 await go('/demo/investigation');await page.locator('.report-guide').waitFor();await page.evaluate(()=>document.body.style.zoom='.9');
 await page.locator('.report-guide').scrollIntoViewIfNeeded();await sleep(500);
 await page.locator('.report-guide-nav button').nth(0).click();if(process.argv[2]!=='results-only')await capture('33-guided-proof','Explain the recorded finding',8);
 await page.locator('.report-guide-nav button').nth(1).click();if(process.argv[2]!=='results-only')await capture('34-guided-check','Show the authorization boundary',12);
 await page.locator('.report-guide-nav button').nth(2).click();await capture('35-guided-results','Compare paired replay results',15);
 await page.locator('.report-guide-nav button').nth(3).click();if(process.argv[2]!=='results-only')await capture('36-stopping-rules','Separate playback, connected tests and repeated experiments',24);
 const body=await page.locator('.report-focus').innerText();if(!body.includes('3 attack replays')||!body.includes('8 attack-and-fix rounds')||!body.includes('No new tests'))throw Error('Stopping scope missing');
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.body.style.zoom='1');await page.locator('.report-guide').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'flow-audio/report-mobile.png')});
 const overflow=await page.locator('.report-guide').evaluate(e=>e.scrollWidth>e.clientWidth+2);if(overflow)throw Error('Report overflows on mobile');
 fs.writeFileSync(path.join(out,'flow-audio/report-validation.json'),JSON.stringify({errors,stopScopes:true,mobileReportOverflow:overflow,proof:'Recorded tool and before/after fields visible before raw details'},null,2));
}finally{await browser.close();}

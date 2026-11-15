// Capture the real local UI. No mocked responses or paid requests.
/* global process, console, URL, setTimeout, document, HTMLInputElement, Event, performance, window, Buffer, HTMLMediaElement */
// PLAYWRIGHT_MODULE can point to an existing Playwright installation.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/faultline-tiger-browser/node_modules/playwright/index.mjs');
const out=path.resolve('artifacts/demo-video');
const base=process.env.VIDEO_BASE||'http://127.0.0.1:4327';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1.2});
await context.addInitScript({path:'scripts/video/assets/capture-audio.js'});
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
async function focus(selector){await page.locator(selector).first().evaluate(e=>e.scrollIntoView({block:'center',behavior:'instant'}));await sleep(200);}
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

const lines=JSON.parse(fs.readFileSync(path.join(out,'flow-audio/spoken-lines.json')));
await page.route('**/api/stories/prompt-round-01',async route=>{const response=await route.fetch();const data=await response.json();const s=data;for(const line of lines){const e=s.events.find(e=>e.seq===line.seq);if(e.text!==line.text)throw Error('Transcript changed');e.audio={src:line.src,start:0,end:line.duration};}await route.fulfill({response,json:data});});
try {
 await go('/analysis/story/prompt-round-01');await page.locator('.scrubber input').waitFor();await seek(0);await focus('.conversation');
 await page.evaluate(lines=>{window.__spoken=[];window.__flowEpoch=0;const native=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){const line=lines.find(x=>x.src===this.src);if(line)window.__spoken.push({seq:line.seq,start:(performance.now()-window.__flowEpoch)/1000,duration:line.duration});return native.call(this);};},lines);
 const markers={};
 await capture('30-audible-attack','Recorded text experiment with stock-voice playback',0,async()=>{const start=performance.now();await page.evaluate(()=>window.__flowEpoch=performance.now());await page.getByRole('button',{name:'Play or pause',exact:true}).click();await page.locator('.arena-breach-vignette').waitFor({timeout:300000});markers.breach=(performance.now()-start)/1000;markers.speech=await page.evaluate(()=>window.__spoken);markers.dialogueEnd=Math.max(...markers.speech.map(x=>x.start+x.duration));await sleep(3500);markers.end=(performance.now()-start)/1000;},{captureAudio:true,storyId:'prompt-round-01',audioType:'synthetic-transcript',transcript:lines.map(x=>x.speaker+': '+x.text).join('\n'),markers});
 if(process.argv[2]!=='attack-only'){await story('checks-round-02',146.1);await page.evaluate(()=>document.body.style.zoom='.85');await focus('.approval');
 await capture('31-check-explained','Server-side check from the separate checks experiment',12,async()=>{},{storyId:'checks-round-02',sourceTimes:[146.1]});
 await seek(176.1);await focus('.proof');
 await capture('32-results-explained','Paired attack and normal-call results',15,async()=>{},{storyId:'checks-round-02',sourceTimes:[176.1]});
}
}finally{fs.writeFileSync(path.join(out,'flow-audio/browser-errors.json'),JSON.stringify(errors));await browser.close();}

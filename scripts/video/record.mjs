// Capture the real local UI. No mocked responses or paid requests.
/* global process, console, URL, setTimeout, document, HTMLInputElement, Event, performance, window, Buffer */
// PLAYWRIGHT_MODULE can point to an existing Playwright installation.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/tmp/faultline-tiger-browser/node_modules/playwright/index.mjs');
const out=path.resolve('artifacts/demo-video');
const base=process.env.VIDEO_BASE||'http://127.0.0.1:4327';
const stories=JSON.parse(fs.readFileSync(path.join(out,'data/stories.json')));
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
const only=process.argv[2]||'all';
try{
 if(['motion','response'].includes(only)){
  const sip='sip-2026-11-13T19-44-27-620Z-live';
  async function openAudible(id,t){await go('/analysis/story/'+id);await page.locator('.scrubber input').waitFor();await seek(t);await focus('.conversation');}
  async function startPlayback(){await page.getByRole('button',{name:'Play or pause',exact:true}).click();}
  if(only==='motion'){await openAudible(sip,0);
  await capture('21-ringing','Recorded playback · platform-generated ringing',2.8,async()=>{await sleep(300);await startPlayback();},{captureAudio:true,storyId:sip,audioType:'presentation-ring',transcript:'[Simulated ringing]'});}
  const s=stories.find(s=>s.id===sip);
  for(const [id,turn,speaker]of [['22-call-identity',1,'red'],['23-call-confirmation',2,'red'],['25-call-response',2,'agent']]){
   if(only==='response'&&id!=='25-call-response')continue;
   const e=s.events.find(e=>e.type==='say'&&e.turn===turn&&e.speaker===speaker);await openAudible(sip,Math.ceil(e.at*10)/10+.1);
   await page.waitForFunction(text=>document.querySelector('.conversation p')?.textContent===text,e.text);
   await capture(id,'Original SIP call audio · animated recorded playback',e.audio.end-e.audio.start+.7,async()=>{await sleep(250);await startPlayback();},{captureAudio:true,storyId:sip,sourceTimes:[e.audio.start,e.audio.end],transcript:e.text,audioType:'original-call',motion:true});
  }
  if(only==='motion'){await openAudible(sip,60.4);await page.getByRole('button',{name:'Mute replay',exact:true}).click();await focus('.conversation');
  await capture('24-sip-breach','Recorded tool + message artifact · breach reveal',8,async()=>{await sleep(500);await startPlayback();await page.locator('.arena-breach-vignette').waitFor();},{storyId:sip,sourceTimes:[60.4,62.67],motion:true});
  await openAudible('prompt-round-01',21.4);await page.getByRole('button',{name:'Mute replay',exact:true}).click();await focus('.conversation');
  await capture('26-card-breach-motion','Recorded text experiment · backend breach reveal',21,async()=>{await sleep(300);await startPlayback();await page.locator('.arena-breach-vignette').waitFor();},{storyId:'prompt-round-01',sourceTimes:[21.4,37.2],motion:true});
  await page.getByRole('button',{name:'Evidence',exact:true}).click();await page.getByText('Tool and record evidence',{exact:true}).click();
  await capture('27-inspect-evidence','User action · inspect recorded evidence',7,async()=>{},{storyId:'prompt-round-01',motion:true});}
 }
 if(only==='setup'){
  await go('/new');
  await click(page.getByRole('button',{name:/Use a saved target/}));
  await click(page.getByRole('button',{name:'Map saved target'}));
  await click(page.getByRole('button',{name:'Set target persona'}));
  await page.locator('.target-persona').waitFor();
  await page.locator('.target-persona select').selectOption('Brief & direct');
  await page.evaluate(()=>window.scrollTo(0,0));
  await capture('19-agent-profile','2 · Name your agent · actual platform UI',13,async()=>{
   await sleep(1500);
   const name=page.getByLabel('Agent name',{exact:true});await click(name);await name.fill('');await name.pressSequentially('Pioneer',{delay:160});
   await sleep(1000);const style=page.locator('.target-persona select');await click(style);await style.press('Home');await style.press('ArrowDown');await style.press('Enter');await style.selectOption('Calm & precise');
   await page.mouse.move(1570,880,{steps:12});await sleep(2000);
  },{actualPlatform:true,configuration:{target:'Pioneer',style:'Calm & precise'},noRunStarted:true});
  await capture('20-redteam-selection','3 · Select a red-team agent · actual platform UI',15,async()=>{
   await sleep(1000);await click(page.getByRole('button',{name:'Choose an attacker',exact:true}));
   await page.locator('.chosen-target').waitFor();await page.evaluate(()=>window.scrollTo(0,0));await sleep(1200);
   await page.locator('.chosen-target select').selectOption('lost_card');await sleep(1500);
   await click(page.locator('.persona-choice').filter({hasText:'Avery'}));await sleep(1600);
   await click(page.locator('.persona-choice').filter({hasText:'Jules'}));await sleep(1800);
   await page.getByRole('button',{name:'Test as Jules'}).scrollIntoViewIfNeeded();
  },{actualPlatform:true,configuration:{target:'Pioneer',style:'Calm & precise',attacker:'jules',caseId:'lost_card'},noRunStarted:true});
  const selected=await page.locator('.persona-choice[aria-pressed="true"]').innerText();
  if(!selected.includes('Jules'))throw Error('Expected Jules to be selected');
  if(await page.locator('.chosen-target h2').innerText()!=='Pioneer')throw Error('Target name did not persist');
  fs.writeFileSync(path.join(out,'data/setup-validation.json'),JSON.stringify({target:'Pioneer',style:await page.locator('.chosen-target p').first().innerText(),attacker:selected,permission:await page.locator('.chosen-target select').inputValue(),route:page.url(),noRunStarted:!page.url().includes('/analysis/run/')}));
 }
 if(['all','intro'].includes(only)){
  await go('/');await capture('01-landing','Wisprno',7);
  await go('/new');await page.getByRole('button',{name:/Use a saved target/}).waitFor();
  await capture('02-connect','Local source inspection · no model calls',9,async()=>{await sleep(1200);await click(page.getByRole('button',{name:/Use a saved target/}));await sleep(1500);await click(page.getByRole('button',{name:'Map saved target'}));await page.locator('.discovery').waitFor();});
  await focus('.discovery');await capture('03-permission-map','Declared tools and checks · runtime paths untested',10,async()=>{await sleep(1500);const el=page.locator('.discovered').filter({hasText:'lock_card'}).first();if(await el.count()){await click(el);await focus('.tool-inspector');}});
  await click(page.getByRole('button',{name:'Set target persona'}));await page.locator('.target-persona input').first().fill('Pioneer');
  await click(page.getByRole('button',{name:'Choose an attacker'}));await page.locator('.chosen-target select').selectOption('lost_card');
  await capture('04-attacker','Setup demonstration · scripted local target',8,async()=>{await sleep(1300);await click(page.locator('.persona-choice').filter({hasText:'Jules'}));});
 }
 if(['all','evidence','results'].includes(only)){
  const id='prompt-round-01';
  if(only!=='results'){
  await story(id,10.2);await focus('.conversation');
  await capture('05-refusal','Recorded text experiment · prompt strategy, round 1',8,async()=>{await sleep(4500);await seek(15.4);},{storyId:id,sourceTimes:[10.2,15.4]});
  await seek(18.4);await capture('06-pivot','Recorded text experiment · prompt strategy, round 1',11,async()=>{await sleep(5000);await seek(23.6);},{storyId:id,sourceTimes:[18.4,23.6]});
  await seek(31.8);await capture('07-record-change','Recorded backend evidence · synthetic account',11,async()=>{await sleep(2500);await seek(37.2);await focus('.proof');},{storyId:id,sourceTimes:[31.8,37.2]});
  await seek(50.7);await focus('.short-call');await capture('08-shortest','Recorded text experiment · 10 minimizer replays',13,async()=>{},{storyId:id,sourceTimes:[50.7]});
  await story('checks-round-02',146.08);await focus('.approval');await capture('09-server-check','Separate experiment · checks strategy, round 2',11,async()=>{},{storyId:'checks-round-02',sourceTimes:[146.08]});
  }else await story('checks-round-02',176.1);
  await seek(176.1);await focus('.results');await capture('10-paired-results','Same three-line attack · checks round 2 · v0 → v5',15,async()=>{},{storyId:'checks-round-02',sourceTimes:[176.1]});
 }
 if(['all','sip'].includes(only)){
  const id='sip-2026-11-13T19-44-27-620Z-live';const s=stories.find(x=>x.id===id);
  for(const [n,turn,speaker] of [['11-sip-claim',1,'red'],['12-sip-confirm',2,'red'],['13-sip-response',2,'agent']]){
   const e=s.events.find(x=>x.type==='say'&&x.turn===turn&&x.speaker===speaker);const start=e.audio.start,end=e.audio.end;
   await story(id,start);await focus('.conversation');
   await capture(n,'Recorded SIP call · our own test line · synthetic data',end-start,async()=>{const t0=performance.now();while((performance.now()-t0)/1000<end-start){await seek(start+(performance.now()-t0)/1000);await sleep(150);}},{storyId:id,sourceTimes:[start,end],audio:{file:'results/sip/2026-11-13T19-44-27-620Z-live/call-clean.mp3',start,end},transcript:e.text});
  }
  await story(id,62.67);await focus('.proof');await capture('14-sip-evidence','Recorded SIP evidence · tool call + verified message artifact',8,async()=>{},{storyId:id,sourceTimes:[62.67]});
 }
 if(['all','workflow'].includes(only)){
  await go('/new');await click(page.getByRole('button',{name:/Use a saved target/}));await click(page.getByRole('button',{name:'Map saved target'}));await click(page.getByRole('button',{name:'Set target persona'}));await page.locator('.target-persona input').first().fill('Pioneer');await click(page.getByRole('button',{name:'Choose an attacker'}));await page.locator('.chosen-target select').selectOption('lost_card');
  await click(page.getByRole('button',{name:/Test as Morgan/}));await page.waitForURL('**/analysis/run/**');await page.locator('.scrubber input').waitFor();
  if(await page.getByRole('button',{name:'Mute replay',exact:true}).count())await click(page.getByRole('button',{name:'Mute replay',exact:true}));
  const runId=page.url().split('/').at(-1);fs.writeFileSync(path.join(out,'data/workflow-run.json'),JSON.stringify({runId}));
  let data,proposal;
  for(let i=0;i<120;i++){data=await (await context.request.get(base+'/api/runs/'+runId)).json();proposal=data.messages.find(m=>m.kind==='event'&&m.event.type==='proposal')?.event;if(proposal)break;await sleep(500);}
  if(!proposal)throw Error('No simulation proposal');
  // Use the visible review control to seek the paced live event stream.
  const review=page.getByRole('button',{name:/A check is ready/});if(await review.count())await click(review);else {await page.getByRole('button',{name:'Review',exact:true}).click();}
  await page.getByRole('button',{name:'Approve & retest'}).waitFor();await focus('.approval');
  await capture('15-approve-workflow','Workflow demonstration · simulated models · no measured claim',12,async()=>{await sleep(6000);await click(page.getByRole('button',{name:'Approve & retest'}));},{runId,simulation:true});
  for(let i=0;i<120;i++){data=await (await context.request.get(base+'/api/runs/'+runId)).json();if(data.done)break;await sleep(500);}
  await go('/analysis/run/'+runId);await page.locator('.scrubber input').waitFor();await seek(Number(await page.locator('.scrubber input').getAttribute('max')));await focus('button.save');
  await capture('16-save-regression','Workflow demonstration · simulated models · saved local regression',9,async()=>{await sleep(2200);await click(page.getByRole('button',{name:'Save as test',exact:true}));await page.getByRole('button',{name:'Regression saved',exact:true}).waitFor();},{runId,simulation:true});
 }
}finally{fs.writeFileSync(path.join(out,'browser-errors.json'),JSON.stringify(errors,null,2));await browser.close();}

// Local scripted acceptance. Real browser and handlers, no provider calls.
import {mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {companionHub} from '../src/companion/hub.ts';
import {startUiServer} from '../src/loop/server.ts';
const {launchLocal,workerRequest,pollOnce}=await import(new URL('./companion.mjs',import.meta.url).href);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'/tmp/faultline-tiger-browser/node_modules/playwright/index.mjs');
const out=resolve(process.env.ACCEPTANCE_OUT??'artifacts/plug-and-play'),root=join(out,'state');mkdirSync(root,{recursive:true});
const target=await launchLocal({cwd:resolve('tests/fixtures/existing-js')});
const server=process.env.ACCEPTANCE_BASE?null:await startUiServer({root,port:0,sim:true,page:resolve('faultline-ui/dist/index.html'),stories:()=>[]});
const base=(process.env.ACCEPTANCE_BASE??server!.url).replace(/\/$/,'');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
const errors:string[]=[],checks:any[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
await context.route('**/*',(r:any)=>['127.0.0.1',new URL(base).hostname].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
let stopped=false,worker:Promise<void>|undefined,pair:any;const ownedRuns:string[]=[];
const shot=async(name:string)=>page.screenshot({path:join(out,name+'.png'),fullPage:true});
try{
 await page.goto(base+'/new');
 await page.locator('input[type=file]').setInputFiles(resolve('tests/fixtures/existing-js'));
 await page.getByRole('button',{name:/Upload .*source files/}).click();
 await page.getByRole('button',{name:'Create pairing code',exact:true}).click();
 await page.getByLabel('Pairing code',{exact:true}).waitFor();
 await page.reload();
 await page.getByRole('button',{name:'Generate new pairing code',exact:true}).click();
 let code=await page.getByLabel('Pairing code',{exact:true}).textContent();
 if(server){companionHub(root).pairs.get(code.split('.')[0])!.expires=Date.now()-1;
 await page.getByRole('button',{name:'Generate new pairing code',exact:true}).click();
 await page.waitForFunction((old:string)=>{const node=document.querySelector('.pair-code');return node&&node.textContent!==old;},code);
 code=await page.getByLabel('Pairing code',{exact:true}).textContent();
 }
 const [id,key]=code.split('.');
 checks.push({pairingReloadRecovery:true,expiredPairingReplacement:!!server});
 await context.storageState({path:join(root,'browser-session.json')});chmodSync(join(root,'browser-session.json'),0o600);
 pair=await workerRequest(base,id,key,'join');
 worker=(async()=>{while(!stopped){try{await pollOnce(base,pair.id,pair.workerKey,target.target);}catch(e){if(!stopped)throw e;}}})();
 await page.getByLabel('I control this deployment').check();
 await page.getByRole('button',{name:'Check connection',exact:true}).click();
 await page.getByRole('heading',{name:'Confirm evaluator policy'}).waitFor();
 await shot('01-policy');
 await page.getByLabel('I confirm this policy').check();
 await page.getByRole('button',{name:'Validate & save target',exact:true}).click();
 await page.getByRole('button',{name:'Open permission map',exact:true}).click();
 await page.getByRole('button',{name:'dispatchParcel',exact:true}).first().press('Enter');
 await shot('02-map');
 await page.getByRole('button',{name:'Set target persona',exact:true}).click();
 await page.getByRole('button',{name:'Choose an attacker',exact:true}).click();
 await context.route('**/api/live/*/stream',(route:any)=>route.abort());
 checks.push({sseInterrupted:true,snapshotRecoveryRequired:true});
 await page.getByRole('button',{name:'Test as Morgan',exact:true}).click();
 await page.waitForURL('**/analysis/run/**');
 const runId=page.url().split('/').at(-1);ownedRuns.push(runId);
 for(let i=0;i<600;i++){const r=await context.request.get(base+'/api/runs/'+runId).then((r:any)=>r.json());if(r.pending)break;if(r.done)throw Error('Investigation ended before proposal');if(i===599)throw Error('Proposal not reached');await new Promise(r=>setTimeout(r,100));}
 await page.reload();
 await page.getByRole('button',{name:/A check is ready/}).click();
 await page.getByRole('button',{name:'Approve & retest',exact:true}).waitFor();
 for(const [width,height] of [[1440,900],[1280,800],[1280,720],[390,844]]){
  await page.setViewportSize({width,height});
  await page.getByRole('button',{name:'Approve & retest',exact:true}).scrollIntoViewIfNeeded();
  await shot('approval-'+width+'x'+height);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
  const reachable=await page.getByRole('button',{name:'Approve & retest',exact:true}).evaluate((button:any)=>{const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
  checks.push({viewport:{width,height},horizontalOverflow:overflow,approvalReachable:reachable});
 }
 await page.setViewportSize({width:1280,height:800});
 await page.evaluate(()=>{document.documentElement.style.zoom='1.5';});await shot('approval-zoom150');
 checks.push({zoom:1.5,horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1)});
 await page.evaluate(()=>{document.documentElement.style.zoom='';});
 await page.getByRole('button',{name:'Approve & retest',exact:true}).focus();
 await page.keyboard.press('Enter');
 for(let i=0;i<300;i++){const r=await context.request.get(base+'/api/runs/'+runId).then((r:any)=>r.json());if(r.done)break;if(i===299)throw Error('Investigation did not finish');await new Promise(r=>setTimeout(r,100));}
 await page.reload();
 await page.getByRole('button',{name:'Save as test',exact:true}).click();
 await page.getByRole('button',{name:'Regression saved',exact:true}).waitFor();
 await shot('03-report');
 const run=await context.request.get(base+'/api/runs/'+runId).then((r:any)=>r.json());
 const accepted=run.messages.some((m:any)=>m.kind==='event'&&m.event.type==='fix'&&m.event.accepted);
 if(!accepted)throw Error('Browser run did not accept the candidate');
 const repo=run.messages.find((m:any)=>m.kind==='story').story.configuration.repositoryId;
 for(const action of ['decline','abort']){
  await page.goto(base+'/new');
  await page.getByRole('button',{name:/Use a saved target/}).click();
  await page.locator('.connection-panel select').selectOption(repo);
  await page.getByRole('button',{name:'Map saved target',exact:true}).click();
  await page.getByRole('button',{name:'Set target persona',exact:true}).click();
  await page.getByRole('button',{name:'Choose an attacker',exact:true}).click();
  await page.getByRole('button',{name:'Test as Morgan',exact:true}).click();
  await page.waitForURL('**/analysis/run/**');const id=page.url().split('/').at(-1);ownedRuns.push(id);
  if(action==='decline'){await page.getByRole('button',{name:/A check is ready/}).click();await page.getByRole('button',{name:'Decline candidate',exact:true}).click();}
  else await page.getByRole('button',{name:'Stop investigation',exact:true}).click();
  let ended;for(let i=0;i<300;i++){ended=await context.request.get(base+'/api/runs/'+id).then((r:any)=>r.json());if(ended.done)break;await new Promise(r=>setTimeout(r,100));}
  if(!ended?.done||ended.messages.some((m:any)=>m.kind==='event'&&m.event.type==='trial'&&m.event.suite==='after'))throw Error(action+' started candidate work');
  checks.push({action,runId:id,done:true});await shot(action);
 }
 const evidence=await context.request.get(base+'/api/runs/'+runId+'/evidence');if(evidence.status()!==200)throw Error('Final evidence bundle missing');
 let ingestion;for(let i=0;i<100;i++){const h=await context.request.get(base+'/api/history').then((r:any)=>r.json());ingestion=h.items.find((r:any)=>r.id===runId)?.ingestion;if(!process.env.ACCEPTANCE_BASE||ingestion?.status==='synced'||ingestion?.state==='synced')break;await new Promise(r=>setTimeout(r,100));}
 checks.push({immutableBundle:true,ingestion});
 writeFileSync(join(out,'browser.json'),JSON.stringify({mode:'simulation',runId,accepted,checks,errors,run},null,2));
 if(errors.length||checks.some(c=>c.horizontalOverflow||c.approvalReachable===false))throw Error('Browser console or layout failures: '+JSON.stringify({errors,checks}));
 console.log(JSON.stringify({runId,accepted,checks,errors}));
}catch(e){await shot('failure');throw e;}finally{for(const id of ownedRuns){const r=await context.request.get(base+'/api/runs/'+id).then((r:any)=>r.json()).catch(()=>null);if(r&&!r.done)await context.request.post(base+'/api/live/'+id+'/stop',{data:{}}).catch(()=>{});}
 stopped=true;if(pair)await workerRequest(base,pair.id,pair.workerKey,'disconnect').catch(()=>{});await browser.close();server?.close();target.stop();await worker?.catch(()=>{});}

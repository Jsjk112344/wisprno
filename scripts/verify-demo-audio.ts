import {readFileSync,mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {startUiServer} from '../src/loop/server.ts';
const {chromium}=await import('/tmp/faultline-tiger-browser/node_modules/playwright/index.mjs');
const server=process.env.DEMO_BASE?null:await startUiServer({root:mkdtempSync(join(tmpdir(),'demo-audio-')),port:0,sim:true,page:resolve('faultline-ui/dist/index.html'),stories:()=>JSON.parse(readFileSync('ui/loop/stories.json','utf8'))});
const base=(process.env.DEMO_BASE??server!.url).replace(/\/$/,'');const out=process.env.DEMO_OUT??'artifacts/demo-audio/local';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const results:any[]=[];
try{for(const name of ['Morgan','Jules','Avery']){
 const page=await browser.newPage({viewport:{width:1280,height:800}});const errors:string[]=[],posts:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));page.on('request',(r:any)=>{if(r.method()==='POST')posts.push(r.url());});
 await page.addInitScript(()=>{const Native=window.Audio;(window as any).__audio=[];(window as any).Audio=function(src:string){const a=new Native(src);(window as any).__audio.push(a);return a;};});
 await page.goto(base+'/demo/new?step=attacker');await page.getByRole('button',{name:new RegExp('^'+name)}).click();await page.screenshot({path:join(out,name+'-selected.png')});await page.getByRole('button',{name:'Start investigation',exact:true}).click();await page.getByLabel('Playback speed').selectOption('50');
 await page.waitForFunction(()=>(window as any).__audio.some((a:HTMLAudioElement)=>a.currentTime>.1&&!a.paused&&a.readyState>=2),{},{timeout:20000});
 const audio=await page.evaluate(()=>{const a=(window as any).__audio.find((a:HTMLAudioElement)=>a.currentTime>.1&&!a.paused);return {time:a.currentTime,duration:a.duration,rate:a.playbackRate,muted:a.muted,volume:a.volume};});
 await page.getByRole('button',{name:'Mute audio',exact:true}).click();await page.waitForFunction(()=>(window as any).__audio.every((a:HTMLAudioElement)=>a.paused));
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'Approve & retest',exact:true}).waitFor();await page.getByRole('button',{name:'Approve & retest',exact:true}).click();}
 await page.locator('#report').waitFor();if(!(await page.locator('#report').innerText()).includes('20 of 20'))throw Error('Missing final result');
 await page.reload();await page.locator('#report').waitFor();if(!(await page.locator('.context').innerText()).includes(name))throw Error('Persona lost on reload');
 if(errors.length||posts.length)throw Error(JSON.stringify({errors,posts}));results.push({name,audio,mutingStopsAudio:true,completed:true,reloadPreservesPersona:true,posts,errors});await page.close();
 }writeFileSync(join(out,'checks.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();server?.close();}

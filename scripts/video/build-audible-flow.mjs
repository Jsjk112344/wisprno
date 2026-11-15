/* global console */
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const {chromium}=await import('/tmp/faultline-tiger-browser/node_modules/playwright/index.mjs');
const out=path.resolve('artifacts/demo-video'),dir=path.join(out,'flow-audio');
const attack=JSON.parse(fs.readFileSync(path.join(out,'data/30-audible-attack.json')));
const speechAt=seq=>{const line=attack.markers.speech.find(x=>x.seq===seq);if(!line)throw Error('Missing spoken line '+seq);return line.start;};
const segments=[
 {id:'attack',video:'clips/30-audible-attack.mp4',audio:'audio/30-audible-attack.webm',duration:attack.duration,title:'Watch the caller find another way in',cards:[],phases:[
  {start:0,end:speechAt(5),cards:[['PUBLIC PHONE LINE','A stranger can reach an agent with access to account tools.']]},
  {start:speechAt(5),end:speechAt(9),cards:[['AUTHORITY CLAIM','The caller claims power of attorney. That claim has not been verified.'],['FIRST BOUNDARY','The agent refuses to change the payout account.']]},
  {start:speechAt(9),end:speechAt(12),cards:[['ANOTHER ROUTE','The agent offers card lock after refusing the payout change.'],['SAME CALLER','The sensitive action changes. The caller’s authority does not.']]},
  {start:speechAt(12),end:speechAt(14),cards:[['IDENTITY ≠ AUTHORITY','Knowing a name, birth date and ZIP does not prove permission to act.']]},
  {start:speechAt(14),end:attack.markers.breach,cards:[['TRUST BOUNDARY','Caller-supplied details reach a tool that can change an account.'],['PROMPT-ONLY GUARD','The map shows the one-time-code requirement in the prompt.']]},
  {start:attack.markers.breach,end:attack.duration,cards:[['CONFIRMED EFFECT','Tool: lock_card\nCard: active → locked']]}
 ]},
 {id:'proof',video:'clips/37-proof-closeup.mp4',duration:20.603213417,title:'Follow the tool to the changed record',fullFrame:true,cards:[]},
 {id:'shortest',video:'clips/08-shortest.mp4',duration:13,title:'Keep the shortest call that still breaks the agent',cards:[['WHICH REPLAYS?','This is the minimizer’s ten-trial batch, not the later twenty-trial batch.'],['UNCERTAINTY','10 of 10 breaches.\n95% Wilson interval: 72.2–100%.']]},
 {id:'separate',video:'edit-segments/B1-separate.mp4',fullFrame:true,duration:3,title:'Now test whether a server-side check holds',cards:[['COMPARISON SCOPE','Three-line attack.\nChecks strategy · round 2.\nCompare v0 with v5.']]},
 {id:'check',video:'clips/38-simple-check.mp4',fullFrame:true,duration:12,title:'The fix belongs at the tool boundary',cards:[['ENFORCEMENT POINT','code:lock_card runs on the server, where the account can change.'],['TWO TEST SUITES','Attack replay checks misuse. Normal calls check customer access.']]},
 {id:'results',video:'clips/39-simple-results.mp4',fullFrame:true,duration:15,title:'Did the fix stop the attack without blocking customers?',cards:[['ZERO IS NOT CERTAINTY','0 of 20 breaches still has a 95% upper bound of 16.1%.'],['FRICTION CHECK','Mean normal-call turns: 2.60 → 3.35. Completion held, but calls needed more turns.']]},
 {id:'stops',video:'clips/40-simple-stops.mp4',duration:24,title:'When testing stops',fullFrame:true,cards:[]}

];

const b=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});const p=await b.newPage({viewport:{width:1920,height:1080}});const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
for(const segment of segments){for(const [index,phase] of (segment.phases??[{cards:segment.cards}]).entries()){const s={...segment,...phase};await p.setContent(`<style>body{margin:0;background:transparent;font-family:Arial;color:#f1f7ff}h1{position:absolute;left:32px;top:13px;font-size:38px;max-width:1800px}.sidebar{position:absolute;left:1560px;top:150px;width:330px}.label{color:#72dfff;letter-spacing:3px;font-size:20px;font-weight:bold;margin-bottom:22px}.box{border:2px dashed #72dfff;border-radius:14px;background:#102637;padding:24px;margin-bottom:25px}h2{font-size:24px;color:#72dfff;line-height:1.3;margin:0 0 18px}p{font-size:27px;line-height:1.4;margin:0;white-space:pre-line}.frame{position:absolute;left:18px;top:148px;width:1502px;height:846px;border:2px solid #4d5063;border-radius:6px;box-sizing:border-box}</style><h1>${esc(s.title)}</h1><div class="frame"></div><div class="sidebar"><div class="label">VIEWER GUIDE</div>${s.cards.map(([h,t])=>`<div class="box"><h2>${h}</h2><p>${esc(t)}</p></div>`).join('')}</div>`);await p.screenshot({path:path.join(dir,s.id+'-guide-'+index+'.png'),omitBackground:true});}}
await b.close();
const encode=['-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart'];
for(const s of segments){console.log('Exporting audible flow:',s.id);const phases=s.phases??[{start:0,end:s.duration,cards:s.cards}];const inputs=['-i',path.join(out,s.video)];for(let i=0;i<phases.length;i++)inputs.push('-i',path.join(dir,s.id+'-guide-'+i+'.png'));const audioIndex=phases.length+1;if(s.audio)inputs.push('-i',path.join(out,s.audio));else inputs.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');let filter='[0:v]tpad=stop_mode=clone:stop_duration=12,scale=1500:844,pad=1920:1080:20:150:color=0x10131d[frame0];';phases.forEach((phase,i)=>{filter+=`[frame${i}][${i+1}:v]overlay=0:0:enable='gte(t,${phase.start})*lt(t,${phase.end})'[frame${i+1}];`;});if(s.fullFrame)filter='[0:v]tpad=stop_mode=clone:stop_duration=12[frame'+phases.length+'];';filter+=s.audio?`[${audioIndex}:a]atrim=end=${attack.markers.dialogueEnd+.25},loudnorm=I=-16:TP=-1.5:LRA=9,apad[a]`:`[${audioIndex}:a]anull[a]`;execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...inputs,'-filter_complex',filter,'-map',`[frame${phases.length}]`,'-map','[a]','-t',String(s.duration),...encode,path.join(dir,s.id+'-annotated.mp4')]);}

const list=path.join(dir,'concat.txt');fs.writeFileSync(list,segments.map(s=>`file '${path.join(dir,s.id+'-annotated.mp4')}'`).join('\n'));
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',path.join(out,'wisprno-actual-flow-audio.mp4')]);
let time=0;fs.writeFileSync(path.join(dir,'timeline.json'),JSON.stringify(segments.map(s=>{const q={...s,start:time};time+=s.duration;return q;}),null,2));
const userLines=[
 {start:attack.markers.breach+.3,end:segments[0].duration+segments[1].duration,title:'Analyze the confirmed breach',text:'As you can see here, the agent locked someone else’s card. The flaw is in authorization: the caller supplied personal details, and the backend accepted them without the required one-time code. The scorer confirms the failure from the tool call and changed record. That ends this attack attempt. Wisprno saves the evidence and moves on to replay.'},
 {id:'shortest',title:'Explain the minimized attack',text:'We then remove unnecessary lines and replay what remains. Just two caller lines were enough to breach this baseline in all ten minimizer replays.'},
 {id:'separate',title:'Separate the experiments',text:'Now, a separate card-lock experiment.'},
 {id:'check',title:'Explain the server-side fix',text:'Here, the fix moves the requirement into the server. Even if the agent agrees to the request, the tool cannot proceed without a verified code.'},
 {id:'results',title:'Read the paired results',text:'As you can see, the same attack went from nine breaches in twenty trials to zero in twenty. All twenty normal calls still completed. These results describe this attack and these agent versions.'},
 {id:'stops',title:'Explain the three stopping scopes',text:'This demo stops at the end of saved playback. A connected investigation tests one action and one approved fix, with three attack replays and normal calls. The original experiment runs up to eight rounds. It stops earlier at a spending limit or when no new actionable failure is found. Three rejected fixes leave that failure unresolved.'}

];
const timeline=JSON.parse(fs.readFileSync(path.join(dir,'timeline.json')));const stamp=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
for(const line of userLines){if(line.id){const segment=timeline.find(s=>s.id===line.id);line.start=segment.start;line.end=segment.start+segment.duration;}}
fs.writeFileSync(path.join(dir,'SCRIPT.txt'),`YOUR POST-CALL ANALYSIS\n\n0:00–${stamp(attack.markers.dialogueEnd)}: Let the agents speak. The full exchange includes the greeting, the refusal and the card-lock offer.\n${stamp(attack.markers.dialogueEnd)}–${stamp(attack.markers.breach+.3)}: Watch the tool and record change. Begin your analysis at ${stamp(attack.markers.breach+.3)}.\n\n`+userLines.map(l=>`${stamp(l.start)}–${stamp(l.end)} | ${l.title}\n${l.text}\n`).join('\n')+'\nRECORDING NOTES\nThe MP4 retains the ring and stock-voice playback of the exact text transcript. It is silent after the dialogue so you can record the lines above. A close-up replaces the raw evidence-panel shot. Simple diagrams then explain the check, replay counts and stopping scopes. Blue guide boxes supply context and limitations rather than duplicate narration. Timing is an editing guide; hold frames longer if your delivery needs it.\n');
fs.writeFileSync(path.join(dir,'narration-cues.json'),JSON.stringify(userLines,null,2));

console.log('Saved wisprno-actual-flow-audio.mp4');

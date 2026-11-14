import {reduce, sortEvents, pace} from '../../ui/loop/reduce.ts';
export {pace};
export function viewOf(story,t) {
  const events=sortEvents(story.events), visible=events.filter(e=>e.at<=t);
  const view=reduce(story,events,t);
  const proposal=visible.findLast(e=>e.type==='proposal')??null;
  const decision=proposal?visible.findLast(e=>e.type==='decision'&&e.candidate===proposal.candidate):null;
  const candidate=proposal?.candidate??view.testing;
  const after=visible.filter(e=>e.type==='trial'&&e.suite==='after'&&(!candidate||e.version===candidate));
  const normal=visible.filter(e=>e.type==='trial'&&e.suite==='normal'&&(!candidate||e.version===candidate));
  const normalBefore=visible.filter(e=>e.type==='trial'&&e.suite==='normal-before');
  const before=visible.filter(e=>e.type==='trial'&&e.suite==='before');
  const record=view.findings.at(-1)??null;
  let stage=view.phase==='Shrink'?'Shrink':view.phase==='Replay'?'Replay':record?'Record':'Call';
  if(proposal)stage=decision?.approved?'Retest':'Fix';
  if(after.length)stage='Retest';
  if(normal.length)stage='Normal calls';
  if(view.fixed)stage='Result';
  return {...view,record,proposal,decision,stage,before,after,normal,normalBefore,candidate,thoughtSource:visible.findLast(e=>e.type==='thought')?.source??'harness'};
}
export function tally(trials) {
  const total=Math.max(trials.length,...trials.map(e=>e.total??0),0);
  const breached=trials.filter(e=>e.verdict==='breached').length;
  const held=trials.filter(e=>e.verdict==='held').length;
  const inconclusive=trials.filter(e=>e.verdict==='inconclusive'||e.verdict==='untested').length;
  return {total,breached,held,inconclusive,pending:Math.max(0,total-trials.length),tested:trials.length};
}
export function interval(k,n) {
  if(!n)return 'No conclusive trials';
  const z=1.96,d=1+z*z/n,p=k/n,c=(p+z*z/(2*n))/d,r=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/d;
  return `95% interval ${Math.max(0,(c-r)*n).toFixed(1)}–${Math.min(n,(c+r)*n).toFixed(1)} per ${n} conclusive trials`;
}
export function validateStory(data) {
  if(data?.schema!=='faultline.story.v1'||!data.story?.map||!Array.isArray(data.story.events))throw Error('Import a faultline.story.v1 bundle exported from this UI.');
  const s=data.story;
  if(!s.id||!s.map.agent||!s.map.approval||!s.map.record||!s.map.payout||!s.caller||!Array.isArray(s.threats)||!s.version||!Number.isFinite(s.duration))throw Error('Missing story metadata.');
  const types=new Set(['phase','say','thought','keys','tool','record','verdict','remove','shortest','trial','proposal','decision','fix','save','note']);
  const seqs=new Set();let at=-1;
  for(const e of s.events){
    if(!types.has(e.type)||!Number.isFinite(e.at)||e.at<at||!Number.isInteger(e.seq)||seqs.has(e.seq)||typeof e.runId!=='string')throw Error('Events need ordered times, unique sequence IDs and run IDs.');
    at=e.at;seqs.add(e.seq);
    if(['trial','record','verdict'].includes(e.type)&&!['breached','held','inconclusive','untested'].includes(e.verdict))throw Error('Unknown verdict.');
    if(e.type==='record'&&(!['backend-record','tool-call-artifact','transcript-only'].includes(e.tier)||typeof e.before!=='string'||typeof e.after!=='string'||typeof e.tool!=='string'))throw Error('Invalid record evidence.');
    if(e.type==='trial'&&(!['before','after','normal','normal-before'].includes(e.suite)||!Number.isInteger(e.index)||(e.total!==undefined&&(!Number.isInteger(e.total)||e.total<1))))throw Error('Invalid trial.');
    if(e.type==='shortest'&&(!Array.isArray(e.lines)||!e.lines.every(l=>typeof l==='string')))throw Error('Invalid minimized call.');
    if(['fix','proposal'].includes(e.type)&&(!Array.isArray(e.rules)||!e.rules.every(r=>typeof r==='string')))throw Error('Invalid check list.');
  }
  return {...s,duration:Math.max(s.duration,at+1),notes:[...(s.notes??[]),'Imported locally. Source claims have not been authenticated by this server.']};
}

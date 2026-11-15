// Presentation over recorded events. Source IDs, trial verdicts and timestamps stay intact.
export function demoTimeline(source){
 const events=[];let pending=null,at=0;
 const push=e=>{events.push({...e,originalSeq:e.seq,originalAt:e.at,seq:events.length+1,at});at+=e.type==='say'?Math.max(3,Math.min(10,e.text.length/18)):e.type==='trial'?1:2;};
 for(const e of source.events){
  if(e.type==='fix'){
   if(pending)push(pending);
   pending=e;push({...e,type:'proposal'});
  }else push(e);
 }
 if(pending)push(pending);
 return {...source,events,duration:at};
}
export function advanceDemo(story,current,delta,approved){
 const next=Math.min(story.duration,current+delta);
 const gate=story.events.find(e=>e.type==='proposal'&&e.at>=current&&e.at<=next&&!approved.includes(e.candidate));
 return {time:gate?gate.at:next,gate:gate?.candidate??null};
}
export function demoCounts(events,suite,version){
 const rows=events.filter(e=>e.type==='trial'&&e.suite===suite&&(!version||e.version===version));
 return {n:rows.length,breached:rows.filter(e=>e.verdict==='breached').length,held:rows.filter(e=>e.verdict==='held').length,inconclusive:rows.filter(e=>!['breached','held'].includes(e.verdict)).length};
}

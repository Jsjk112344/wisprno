// Reconcile a durable snapshot with newer SSE events without replaying or dropping either.
export function mergeLiveSnapshot(current, snapshot) {
 const header=snapshot.messages?.find(m=>m.kind==='story')?.story;
 if(!header)return current;
 const events=new Map((current?.id===header.id?current.events:[]).map(e=>[e.seq,e]));
 for(const m of snapshot.messages)if(m.kind==='event'&&!events.has(m.event.seq))events.set(m.event.seq,m.event);
 return {...header,events:[...events.values()].sort((a,b)=>a.seq-b.seq)};
}

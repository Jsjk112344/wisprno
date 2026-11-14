import React from 'react';
import {ShieldCheck,Database,Landmark,Workflow,ContactRound} from 'lucide-react';
import {Avatar} from './avatar.jsx';
const edges=[['details-caller','M160 120 C195 120 162 208 195 208'],['tactic-caller','M160 320 C195 320 162 232 195 232'],['caller-agent','M335 208 H395'],['agent-caller','M395 232 H335'],['agent-approval','M535 208 C560 208 563 120 590 120'],['approval-payout','M730 120 H760'],['payout-record','M830 153 V287'],['feedback','M440 253 C440 414 90 414 90 353']];
export default function Map({story,view,playing,attacker,onInspect}) {
  const map=story.map;
  const nodes=[['details',90,120,'Known details',map.details.sub,ContactRound],['tactic',90,320,'Caller tactic',view.stage==='Call'||view.stage==='Record'?view.tactic:story.caller.tactic,Workflow],['caller',265,220,story.caller.short,story.caller.tactic,null],['agent',465,220,map.agent.label,map.agent.sub,null],['rule',660,120,map.approval.label,view.fixed?'Tested check':map.approval.prompt,ShieldCheck],['tool',830,120,map.payout.label,map.payout.tool,Landmark],['record',830,320,view.record?.subject??map.record.label,map.record.field,Database]];
  return <svg className="map" viewBox="0 0 920 435" role="group" aria-label="Caller to agent, permission check, tool and affected record">
    <defs><marker id="end" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8" fill="#b99b8c"/></marker></defs>
    <rect className="territory red" x="8" y="35" width="337" height="338" rx="18"/><rect className="territory blue" x="375" y="35" width="535" height="338" rx="18"/><text className="zone" x="27" y="60">CALLER</text><text className="zone" x="394" y="60">{map.workspace.toUpperCase()}</text>
    {edges.map(([id,d])=>{const active=(view.passes[id]??0)>0;return <g key={id}><title>{id.replaceAll('-',' → ')}: {active?'observed':'possible access'}</title><path d={d} className={`edge ${id==='feedback'?'feedback':''} ${active?'active':''}`} markerEnd="url(#end)"/>{playing&&view.last?.route?.includes(id)&&<circle r="4" fill="#efb398"><animateMotion path={d} dur="1.4s" repeatCount="indefinite"/></circle>}</g>;})}
    {nodes.map(([id,x,y,name,sub,Icon])=><g key={id} transform={`translate(${x} ${y})`} role="button" tabIndex="0" aria-label={`${name}: ${sub}`} onClick={()=>onInspect(id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onInspect(id);}}} className={`node ${id} ${id==='rule'?(view.fixed?'enforced':'prompt'):''} ${id==='record'&&view.record?.verdict==='breached'?'breach':''}`}>
      <title>{name}: {sub}</title><rect x="-70" y="-33" width="140" height="66" rx="9"/>
      {id==='caller'||id==='agent'?<foreignObject x="-62" y="-22" width="42" height="44"><Avatar size={42} id={id==='caller'?attacker?.id:'nora'} color={id==='caller'?attacker?.color:undefined}/></foreignObject>:<Icon x="-59" y="-17" width="32" height="32" strokeWidth="1.5"/>}
      <text className="node-name" x="-19" y="-4">{name.length>14?name.slice(0,13)+'…':name}</text><text className="node-sub" x="-19" y="14">{sub.length>17?sub.slice(0,16)+'…':sub}</text>
    </g>)}
    <text className="feedback-label" x="190" y="410">refusal → new tactic · inferred</text>
  </svg>;
}

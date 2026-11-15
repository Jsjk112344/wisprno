import RepositoryConnection from './repository-connection.jsx';
import {selectSources,inspectSourceGraph} from './source-selection.js';
import {navigate,useRoute} from './navigation.jsx';
import React, {useState, useEffect, useRef} from 'react';
import {FolderOpen, Play, ArrowRight, Shield, Database, Phone, Check, RotateCcw} from 'lucide-react';
import {Avatar} from './avatar.jsx';
import {api} from './api.js';
export {Avatar};
export const PERSONAS = [
  {id:'morgan',name:'Morgan',role:'The Insider',tactic:'Authority',color:'#dfae87',quote:'I’m just correcting a branch error.'},
  {id:'jules',name:'Jules',role:'The Grandchild',tactic:'Urgency',color:'#c6b4e8',quote:'She needs this sorted before closing.'},
  {id:'avery',name:'Avery',role:'The Fixer',tactic:'Pretext',color:'#9ecabf',quote:'Nothing new. Just fixing the details.'},
];
export function Discovery({discovery,count,target,onInspect,selected}) {
  const tools=discovery.tools.filter(t=>t.testCase), height=Math.max(570,100+tools.length*116);
  return <svg className="discovery" viewBox={`0 0 1100 ${height}`} role="group" aria-label="Discovered local tools and the records they can change">
    <defs><clipPath id="repository-label-clip"><rect x="20" y="45" width="140" height="30"/></clipPath><marker id="scan-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8" fill="#8095a9"/></marker></defs>
    <rect x="250" y="25" width="825" height={height-50} rx="24" fill="#19222c" stroke="#30404e"/><text x="277" y="55" className="zone">{discovery.workspace.toUpperCase()}</text>
    <g transform="translate(30 235)"><rect width="180" height="100" rx="18" fill="#292d35" stroke="#697684"/><FolderOpen x="20" y="17" width="28"/><text x="20" y="67" className="discovery-label" clipPath="url(#repository-label-clip)"><title>{discovery.workspace} · {discovery.repository}</title>{discovery.workspace.length>16?discovery.workspace.slice(0,15)+'…':discovery.workspace}</text></g>
    <path className="discovery-edge" d="M210 285H300" markerEnd="url(#scan-arrow)"/>
    <g transform="translate(300 235)"><rect width="170" height="100" rx="18" fill="#30465c" stroke="#8babc3"/><foreignObject x="12" y="14" width="54" height="54"><Avatar size={54}/></foreignObject><text x="80" y="40" className="discovery-label">{target||'Pioneer'}</text><text x="80" y="61" className="node-sub">Voice agent</text></g>
    {tools.map((tool,i)=>{const y=80+i*116;return <g key={tool.name} className={'discovered '+(count>i?'revealed':'')}>
      <path d={`M470 285C520 285 510 ${y+35} 560 ${y+35}`} className="discovery-edge" markerEnd="url(#scan-arrow)"/><path d={`M790 ${y+35}H865`} className="discovery-edge" markerEnd="url(#scan-arrow)"/>
      <g role="button" tabIndex={count>i?0:-1} aria-label={tool.name} onClick={()=>onInspect(tool)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onInspect(tool);}}}>
        <rect x="560" y={y} width="230" height="70" rx="13" fill={selected?.name===tool.name?'#3a4854':'#253340'} stroke={selected?.name===tool.name?'#e0b495':'#4a6072'}/><Shield x="576" y={y+10} width="26" height="26" color="#c5d6e5"/><text x="576" y={y+55} className="tool-label">{tool.name}</text>
      </g><g><rect x="865" y={y} width="180" height="70" rx="13" fill="#232b32" stroke="#46515c"/><Database x="880" y={y+10} width="26" color="#c9b499"/><text x="880" y={y+55} className="discovery-label">{tool.resource||'Unknown resource'}</text></g>
    </g>;})}
  </svg>;
}
const STYLES=['Warm & helpful','Calm & precise','Brief & direct'];
export default function Setup({onStart,onRecording,onResume,resumeId,busy,error,status}) {
  const [selection,setSelection]=useState(null),[operator,setOperator]=useState(null);
  useEffect(()=>{api('/api/operator-status').then(setOperator).catch(()=>setOperator({authenticated:false}));},[]);
  const [budget,setBudget]=useState(null);
  useEffect(()=>{api('/api/spend').then(setBudget).catch(()=>setBudget({error:'Spend service unavailable; paid requests fail closed.'}));},[]);
  const [repositories,setRepositories]=useState([]),[repositoryId,setRepositoryId]=useState(()=>{try{return sessionStorage.getItem('wisprno-setup-repository')||'pioneer';}catch{return 'pioneer';}});
  const rememberRepository=id=>{setRepositoryId(id);try{if(id)sessionStorage.setItem('wisprno-setup-repository',id);else sessionStorage.removeItem('wisprno-setup-repository');}catch{}};
  const folderInput=useRef(null);
  useEffect(()=>{api('/api/repositories').then(d=>setRepositories(d.items)).catch(e=>setFailure(e.message));},[]);
  const route=useRoute();
  const [phase,updatePhase]=useState('connect'),[discovery,setDiscovery]=useState(null),[count,setCount]=useState(0);
  function setPhase(next){updatePhase(next);if(!['mapping','analyzing','launching'].includes(next))navigate('/new'+(next==='connect'?'':'?step='+next));}
  useEffect(()=>{if(!route.startsWith('/new'))return;const step=new URLSearchParams(location.search).get('step')||'connect';if(step==='connect'||discovery)updatePhase(step);else {window.history.replaceState({},'','/new');updatePhase('connect');}},[route]);
  const [target,setTarget]=useState('Agent 01'),[style,setStyle]=useState(()=>STYLES[Math.floor(Math.random()*STYLES.length)]),[attacker,setAttacker]=useState(PERSONAS[0]);
  const [inspect,setInspect]=useState(null),[caseId,setCase]=useState('payout_change'),[failure,setFailure]=useState(''),[loading,setLoading]=useState(false),[spend,setSpend]=useState(false);
  const [,setAction]=useState(null),[,setErrorAt]=useState('repository');
  const [useGemini,setUseGemini]=useState(false),[analysis,setAnalysis]=useState(null),[launchStep,setLaunchStep]=useState(0);
  const startRef=useRef(onStart);startRef.current=onStart;
  const simulation=discovery?.sim??status?.sim;
  const tools=discovery?.tools.filter(t=>t.testCase)??[];
  const mappedDiscovery=analysis?{...discovery,tools:discovery.tools.map(tool=>({...tool,resource:analysis.paths.find(path=>path.tool===tool.name)?.resource??tool.resource}))}:discovery;
  async function connect(){setAction('mapping');setErrorAt('repository');setLoading(true);setFailure('');try{const data=await api('/api/discovery?repository='+encodeURIComponent(repositoryId));setDiscovery(data);if(data.tools.find(t=>t.testCase))setCase(data.tools.find(t=>t.testCase).testCase);setCount(data.tools.filter(t=>t.testCase).length);setPhase('mapped');}catch(e){setFailure(e.message);}finally{setLoading(false);}}
  async function mapPermissions(){
    setFailure('');setLoading(true);setAnalysis(null);
    try{if(useGemini){setPhase('analyzing');setAnalysis(await api('/api/discovery/analyze',{approved:true,repositoryId}));}setCount(tools.length);setPhase('select');}
    catch(e){setFailure(e.message);setPhase('target');}finally{setLoading(false);}
  }
  useEffect(()=>{if(phase!=='mapping')return;if(count>=tools.length){setPhase('mapped');return;}const timer=setTimeout(()=>setCount(v=>v+1),600);return()=>clearTimeout(timer);},[phase,count,tools.length]);
  useEffect(()=>{
    if(phase!=='launching')return;
    if(launchStep<2){const timer=setTimeout(()=>setLaunchStep(v=>v+1),700);return()=>clearTimeout(timer);}
    const timer=setTimeout(()=>{void startRef.current({target:target.trim(),style,attacker:attacker.id,caseId,repositoryId},spend).then(ok=>{if(ok===false)setPhase('select');});},500);
    return()=>clearTimeout(timer);
  },[phase,launchStep,target,style,attacker.id,caseId,spend,repositoryId]);
  async function importFolder(event){
    const selected=Array.from(event.target.files??[]);if(!selected.length)return;setAction('folder');setErrorAt('folder');setLoading(true);setFailure('');
    try{
      setRepositoryId('');setDiscovery(null);const chosen={...selectSources(selected),name:selected[0]?.webkitRelativePath.split('/')[0]||'My repository'};if(!chosen.selected.length)throw Error('No eligible implementation source. Dependencies, credentials and held-out paths are excluded.');
      setSelection(await inspectSourceGraph(chosen));return;
    }catch(e){setFailure(e.message);}finally{setLoading(false);event.target.value='';}
  }

  async function saveSelection(){setLoading(true);setFailure('');try{if(!selection.contents){setSelection(await inspectSourceGraph(selection));return;}const data=await api('/api/repositories',{name:selection.name,guided:true,omitted:selection.omitted,files:selection.contents.filter(f=>selection.selected.some(s=>selection.path(s)===f.file))});rememberRepository(data.id);setRepositories((await api('/api/repositories')).items);setSelection(null);}catch(e){setFailure(e.message);}finally{setLoading(false);}}
  const profile=<section className="target-persona"><Avatar size={106}/><span className="eyebrow">ANONYMOUS TARGET PROFILE</span><label>Agent name<input maxLength={32} value={target} onChange={e=>setTarget(e.target.value)}/></label><label>Conversation style<select disabled={discovery?.adapter==='contract'} value={style} onChange={e=>setStyle(e.target.value)}>{STYLES.map(s=><option key={s}>{s}</option>)}</select></label><p className="panel-note">{discovery?.adapter==='contract'?'This target keeps its deployed prompt and checks. The name is a display label; conversation style is not changed.':'Rename the synthetic agent or adjust its conversation style.'}</p>
    <label className="spend-confirm"><input type="checkbox" checked={useGemini} disabled={!discovery?.mapper?.available} onChange={e=>setUseGemini(e.target.checked)}/>Use Gemini to analyze tool relationships</label>
    <p className="mapping-consent">{discovery?.mapper?.available?<>Enabling this authorizes one Gemini request when you choose Choose an attacker. Sends bounded excerpts of the selected source, prioritizing references to discovered tools. Large selections are partial, with original line citations retained; output capped at 4,000 tokens, no retries. Source-matched results are reused.</>:'Gemini is not configured on this server. Declared catalogue inspection does not call a model.'}</p>
    <details className="spend-details"><summary>Provider limits</summary>{budget?<p>{budget.error??(budget.configured?budget.providers.map(p=>`${p.provider}: $${p.remainingUsd.toFixed(2)} remaining of $${p.capUsd}`).join(' · ')+'. Cumulative reservations; no automatic reset. ElevenLabs disabled.':'Deployment dollar caps are not configured in this local environment.')}</p>:<p>Loading limits…</p>}</details>
    <button className="primary" disabled={!target.trim()||loading} onClick={mapPermissions}>Choose an attacker <ArrowRight size={17}/></button>
  </section>;
  return <div className="setup-shell">
    {phase!=='connect'&&(error||failure)&&<div className="error global-error" role="alert">{error||failure}</div>}
    {phase==='connect'?<RepositoryConnection operator={operator} repositories={repositories} repositoryId={repositoryId} setRepositoryId={setRepositoryId} selection={selection} setSelection={setSelection} folderInput={folderInput} importFolder={importFolder} saveSelection={saveSelection} connect={connect} onConnected={async data=>{rememberRepository(data.id);setRepositories((await api('/api/repositories')).items);}} loading={loading} busy={busy} error={error||failure} onDiscard={()=>{setSelection(null);rememberRepository('');setDiscovery(null);setFailure('');}}/>:
    phase==='target'?<main className="profile-stage"><div><span className="eyebrow">FIRST, THE AGENT</span><h1>A personality before<br/>the permissions.</h1><p>Start with an anonymous target. Its tools come from your repository. Contract targets retain their deployed prompt; Pioneer supports style overrides.</p><div className="profile-facts"><span>{discovery.tools.length} tools discovered</span><span>Owned local deployment</span><span>Synthetic member records</span></div></div>{profile}</main>:
    phase==='analyzing'?<main className="launch-stage" role="status"><div className="analysis-orbit"><Shield size={72}/></div><span className="eyebrow">GEMINI SOURCE ANALYSIS</span><h1>Tracing tools to records and checks.</h1><p>Reading the selected bounded source files. Every returned relationship must cite a matching source line before it appears on the map.</p></main>:
    phase==='launching'?<main className="launch-stage" role="status"><span className="eyebrow">{['THE ADVERSARY','THE TARGET','THE INVESTIGATION'][launchStep]}</span><div className={`launch-pair step-${launchStep}`}><div className="launch-caller"><Avatar id={attacker.id} color={attacker.color} size={144}/><h2>{attacker.name}</h2><p>{attacker.tactic}</p></div><div className="launch-connection"><span/><ArrowRight size={28}/></div><div className="launch-target"><Avatar size={144}/><h2>{target}</h2><p>{style}</p></div></div><h1>{['A new caller. A different motive.','One request. A permission boundary.','Opening the investigation…'][launchStep]}</h1><p>{tools.find(t=>t.testCase===caseId)?.resource} · {simulation?'Simulated text call':'Live text call'} · The graph will follow observed events.</p></main>:
    <main className="setup-main"><div className="setup-title"><div><span className="eyebrow">{phase==='select'?'CHOOSE YOUR CALLER':'AGENT PRIVILEGES'}</span><h1>{phase==='mapping'?'Revealing source catalogue…':phase==='mapped'?'What your agent can access and change.':'Who tests this permission?'}</h1><p className="mapping-description">{phase==='select'?`${target} · ${style}`:'Follow each tool to the record it touches and inspect the checks available to guard it.'}</p></div>{phase==='mapping'?<span className="mapping-count">{count} / {tools.length} actions · presentation</span>:phase==='mapped'?<button className="primary" onClick={()=>setPhase('target')}>Set target persona <ArrowRight size={17}/></button>:<button className="back-link" onClick={()=>setPhase('mapped')}>View privileges</button>}</div>
      {phase==='select'?<div className="attacker-stage"><section className="chosen-target"><Avatar size={120}/><span className="eyebrow">YOUR TARGET</span><h2>{target}</h2><p>{style}</p><label>Permission to test<select value={caseId} onChange={e=>setCase(e.target.value)}>{tools.map(tool=><option key={tool.name} value={tool.testCase}>{tool.resource}</option>)}</select></label><button className="back-link" onClick={()=>setPhase('target')}>Edit target profile</button></section><section className="persona-picker">{PERSONAS.map(p=><button key={p.id} className={'persona-choice '+(p.id===attacker.id?'selected':'')} onClick={()=>setAttacker(p)} aria-pressed={p.id===attacker.id}><Avatar id={p.id} color={p.color} size={74}/><span><b>{p.name}<small>{p.tactic}</small></b><em>{p.role}</em><q>{p.quote}</q></span>{p.id===attacker.id&&<Check className="selected-check" size={16}/>}</button>)}<p className="panel-note">{simulation?'Scripted simulation against the connected synthetic target. No telephone call or model spend.':'Text-mode attack using configured model APIs, not a SIP call.'}</p>{discovery?.adapter==='contract'&&<p>Evidence scope: correlated tool and backend record results. Spoken disclosures remain untested. Bridge candidates change only isolated session prompts.</p>}{discovery?.adapter==='contract'&&!discovery?.capabilities?.automaticFixes&&<p role="status">This connection has not verified full investigation support. Wisprno must supply the missing adapter capabilities before safe fix testing is available.</p>}{!simulation&&<label className="spend-confirm"><input type="checkbox" checked={spend} onChange={e=>setSpend(e.target.checked)}/>Allow model calls within existing provider caps. New bridge investigations also reserve at most $1 and 100 model requests, including retries. The workflow may stop before every stage completes.</label>}{(discovery?.readiness??status?.readiness)&&<p role="status">{(discovery?.readiness??status.readiness).mode} · {(discovery?.readiness??status.readiness).reasons.join(' ')||'Ready. Key presence is not provider verification.'}</p>}<button className="primary launch-call" disabled={busy||(discovery?.readiness??status?.readiness)?.ready===false||(!simulation&&!spend)} onClick={()=>{setLaunchStep(0);setPhase('launching');}}><Phone size={17}/>Test as {attacker.name}<ArrowRight size={17}/></button></section></div>:
      <div className="discovery-wrap"><Discovery discovery={mappedDiscovery} count={count} target={target} onInspect={setInspect} selected={inspect}/>{inspect&&<div className="tool-inspector"><div><code>{inspect.name}</code><p>{inspect.description}</p><small>{inspect.enforcement}</small><p>Declared checks (not proof of enforcement): {inspect.checks.join(', ')||'None declared'}</p>{inspect.citations?.map((c,i)=><pre key={i}>Source-observed reference · {c.file}:{c.line}{'\n'}{c.quote}</pre>)}{analysis?.paths.filter(p=>p.tool===inspect.name).map(p=><div key={p.tool}><b>Gemini interpretation · inferred</b><p>{p.explanation}</p>{p.evidence.map((ref,i)=><pre key={i}>{ref.file}:{ref.line}{'\n'}{ref.quote}</pre>)}</div>)}</div><button aria-label="Close tool detail" onClick={()=>setInspect(null)}>×</button></div>}
      {phase==='mapped'&&<><div className="map-bottom"><span><Shield size={16}/>{tools.length} testable actions · {discovery.tools.length} tools · {analysis?'Gemini interpretation, source-cited':'Declared tool relationships; runtime paths remain untested'}</span><button onClick={()=>{setCount(0);setPhase('mapping');}}><RotateCcw size={14}/>Replay mapping</button><button onClick={()=>setPhase('target')}>Edit target</button></div><details className="catalogue"><summary>All tools and source version</summary>{discovery.scoringPolicy?.handoffLevel&&<p>Evaluation policy: notes attached to a record require {discovery.scoringPolicy.handoffLevel==='otp'?'a verified one-time code':'identity verification'}. This requirement is separate from the target’s declared checks.</p>}<code>tools {discovery.sourceHashes.tools}</code>{analysis&&<p>{analysis.model} · {analysis.label} · {analysis.cached?'Reused source-matched analysis':'Analyzed this source version'}</p>}{discovery.tools.map(tool=><button key={tool.name} onClick={()=>setInspect(tool)}>{tool.name}<small>{tool.group} · {tool.writes?'writes':'no record write'}</small></button>)}</details></>}
      </div>}
    </main>}
  </div>;
}

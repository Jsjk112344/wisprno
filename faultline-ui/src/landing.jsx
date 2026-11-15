import React from 'react';
import {ArrowRight} from 'lucide-react';
import {Link} from './navigation.jsx';
import {Avatar,PERSONAS} from './setup.jsx';
export default function Landing({base=''}){return <main className="connect-stage landing-stage"><div className="opening-copy"><h1>Meet your agent’s<br/>adversary.</h1><p className="setup-tagline">The scammer your voice agent hasn’t met yet.</p><div className="landing-actions"><Link className="primary" to={base+'/new'}>New analysis <ArrowRight size={18}/></Link><Link className="quiet-action" to={base+'/analyses'}>View past analyses</Link></div><p className="workflow-preview">Map → Attack → Shrink → Replay</p></div><div className="cast-preview">{PERSONAS.map((p,i)=><div key={p.id} className={'cast cast-'+i}><Avatar id={p.id} color={p.color} size={160}/><b>{p.name}</b><span>{p.role}</span></div>)}</div></main>;}

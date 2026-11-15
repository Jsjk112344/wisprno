import React,{useEffect,useState} from 'react';
import Brand from './brand.jsx';
export function navigate(path){if(location.pathname+location.search!==path){window.history.pushState({},'',path);window.dispatchEvent(new Event('popstate'));window.scrollTo(0,0);}}
export function useRoute(){const read=()=>location.pathname+location.search;const [route,setRoute]=useState(read);useEffect(()=>{const update=()=>setRoute(read());window.addEventListener('popstate',update);return()=>window.removeEventListener('popstate',update);},[]);return route;}
export function Link({to,children,...props}){return <a href={to} {...props} onClick={e=>{if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&e.button===0){e.preventDefault();navigate(to);}}}>{children}</a>;}
export function Header({demo=false}){return <header className="site-header"><Link to={demo?'/demo':'/'} aria-label="WisprNo home"><Brand/></Link><div className="header-links"><Link to={demo?'/demo/analyses':'/analyses'}>Past analyses</Link>{demo&&<span className="demo-badge">Demo</span>}</div></header>;}

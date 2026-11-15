// Local, unpaid browser verification only. Never uses the held-out specimen.
import {fixture} from '../tests/helpers/bridge-fixture.ts';
import {startUiServer} from '../src/loop/server.ts';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'wisprno-browser-'));
const target=await fixture('typescript');
mkdirSync(join(root,'ui'),{recursive:true});symlinkSync(resolve('ui/brand'),join(root,'ui/brand'));
for(const f of target.files){const path=join(root,'selected-repo',f.file);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,f.text);}
const app=await startUiServer({root,port:0,sim:true,page:resolve('faultline-ui/dist/index.html'),stories:()=>[]});
writeFileSync('/tmp/wisprno-browser-fixture.json',JSON.stringify({root,url:app.url,targetUrl:target.url,source:join(root,'selected-repo')}));
console.log(JSON.stringify({root,url:app.url,targetUrl:target.url}));
process.on('SIGTERM',()=>{app.close();void target.close().then(()=>process.exit());});

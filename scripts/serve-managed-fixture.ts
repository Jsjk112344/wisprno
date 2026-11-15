// Local browser verification only. Starts no containers until the UI explicitly approves one.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {startManagedWorker} from '../src/managed/worker.ts';
import {command} from '../src/managed/runner.ts';
import {startUiServer} from '../src/loop/server.ts';
const root=mkdtempSync(join(homedir(),'.wisprno-managed-browser-')),token=randomBytes(32).toString('hex');
const image=(await command('docker',['image','inspect','node:24-bookworm-slim','--format','{{.Id}}'])).trim();
const worker=await startManagedWorker({root:join(root,'worker'),docker:'docker',runtime:'runc',mode:'local-verification',profiles:[{id:'node-stdlib',name:'Node 24 standard library',language:'node',image,modules:[]}],maxJobs:1},token);
mkdirSync(join(root,'results/ui'),{recursive:true,mode:0o700});writeFileSync(join(root,'results/ui/managed-worker.json'),JSON.stringify({url:worker.url,token}),{mode:0o600});
mkdirSync(join(root,'ui'),{recursive:true});symlinkSync(resolve('ui/brand'),join(root,'ui/brand'));
const source=join(root,'selected-repo');mkdirSync(join(source,'packages/assistant'),{recursive:true});writeFileSync(join(source,'packages/assistant/start.mjs'),readFileSync('tests/fixtures/managed/start.mjs'));
const app=await startUiServer({root,port:0,sim:true,page:resolve('faultline-ui/dist/index.html'),stories:()=>[]});writeFileSync('/tmp/wisprno-managed-browser.json',JSON.stringify({root,source,url:app.url}));console.log(JSON.stringify({root,source,url:app.url}));
process.on('SIGTERM',()=>{void(async()=>{for(const j of worker.runner.jobs.values())await worker.runner.stop(j.id).catch(()=>{});app.close();worker.close();process.exit();})();});

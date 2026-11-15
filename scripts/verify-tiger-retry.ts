// Publish one explicitly labelled fixture archive through the real durable queue.
// Fault injection affects this verification writer only, never the database service.
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {connection} from '../src/tiger/database.ts';
import {InvestigationQueue,syncBundle} from '../src/tiger/investigations.ts';
import {sha256,writeJson} from '../src/runner/util.ts';
const bundlePath=process.argv[2];
let bundle:any;
if(bundlePath)bundle=JSON.parse(readFileSync(bundlePath,'utf8'));
else{
 const meta=JSON.parse(readFileSync('/tmp/wisprno-browser-fixture.json','utf8'));
 const browser=JSON.parse(readFileSync('artifacts/generic-verification/browser.json','utf8'));
 const previousId=new URL(browser.runUrl).pathname.split('/').at(-1)!;
 bundle=JSON.parse(readFileSync(join(meta.root,'results/ui/ingestion',previousId+'.bundle.json'),'utf8'));
}
const id=bundle.id;
if(bundle.executionMode!=='simulation'||!bundle.done)throw Error('Only a completed scripted fixture is permitted.');
const root=mkdtempSync(join(tmpdir(),'wisprno-tiger-retry-'));
const offline=new InvestigationQueue(root,async()=>{throw Error('Injected unavailable database writer');});
writeJson(join(offline.dir,id+'.bundle.json'),bundle);writeJson(join(offline.dir,id+'.state.json'),{state:'pending',attempts:0});
await offline.drain();const failed=offline.state(id);if(failed?.state!=='failed')throw Error('Fault injection did not fail');
const before=sha256(readFileSync(join(offline.dir,id+'.bundle.json'),'utf8'));
const resumed=new InvestigationQueue(root);resumed.retry(id);await resumed.drain();await resumed.drain();
if(resumed.state(id)?.state!=='synced')throw Error('Sync did not complete; inspect configuration privately.');
await syncBundle(bundle); // duplicate insert must reconcile identical hash, not duplicate a row
const client=connection();let storedRows:number;
try{await client.connect();const rows=await client.query('SELECT count(*)::int AS count FROM ui_investigations WHERE id=$1 AND execution_mode=$2',[id,'simulation']);storedRows=rows.rows[0].count;if(storedRows!==1)throw Error('Duplicate sync did not preserve exactly one simulation row');}finally{await client.end();}
const result={id,executionMode:bundle.executionMode,fault:'Injected writer outage; database service was not interrupted',failed,recovered:resumed.state(id),immutable:before===sha256(readFileSync(join(offline.dir,id+'.bundle.json'),'utf8')),duplicateSync:'verified with database query',storedRows};
writeFileSync(process.argv[3]??'artifacts/generic-verification/tiger.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

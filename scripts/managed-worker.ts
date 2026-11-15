// Run only on a dedicated execution host. Never load the harness/provider environment.
import {readFileSync,statSync} from 'node:fs';
import {startManagedWorker} from '../src/managed/worker.ts';
const path=process.argv[2];if(!path)throw Error('Usage: node scripts/managed-worker.ts /private/worker.json');
if(statSync(path).mode&0o077)throw Error('Worker configuration must be private (0600).');
const cfg=JSON.parse(readFileSync(path,'utf8'));if(cfg.mode!=='public-sandbox')throw Error('This worker command requires the public-sandbox profile; local verification uses the test harness explicitly.');
const worker=await startManagedWorker(cfg,cfg.controlToken,cfg.port??4531);
console.log('Managed execution worker listening on loopback. Runtime validation is required before launch.');
process.on('SIGTERM',()=>{worker.close();process.exit();});

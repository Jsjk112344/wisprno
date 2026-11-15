import {existsSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';

// Operator-owned grants. Recurring access retains all provider and request caps.
export function hasRunAllowance(resultsDir:string){
 return process.env.LIVE_SPEND_ENABLED==='true' && ['live-approved','live-approved-recurring'].some(name=>existsSync(join(resultsDir,name)));
}
export function consumeRunAllowance(resultsDir:string){
 if(!hasRunAllowance(resultsDir))throw Error('Paid testing is locked. An operator must enable access.');
 if(!existsSync(join(resultsDir,'live-approved-recurring')))unlinkSync(join(resultsDir,'live-approved'));
}

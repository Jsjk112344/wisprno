import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHistory, runEntry } from '../src/loop/history.ts';
import { tigerError } from '../src/tiger/http.ts';
test('history distinguishes interrupted archives from completed evidence and tolerates corrupt files', () => {
 const root=mkdtempSync(join(tmpdir(),'faultline-history-'));
 try {
  const dir=join(root,'results/ui/runs');mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'unfinished.json'),JSON.stringify({id:'unfinished',done:false,messages:[]}));
  writeFileSync(join(dir,'broken.json'),'{');
  const result=runHistory(root,new Map(),[]);
  assert.equal(result.items.length,1);assert.equal(result.items[0].status,'interrupted');assert.equal(result.items[0].mode,'Unknown mode');assert.equal(result.items[0].verdict,'inconclusive');assert.equal(result.activeRunId,null);assert.equal(result.warnings.length,1);
  assert.equal(runEntry({id:'done',done:true,messages:[{kind:'done',verdict:'held',summary:'Recorded outcome'}]}).verdict,'held');
 } finally{rmSync(root,{recursive:true,force:true});}
});
test('Tiger HTTP errors never expose raw credentials',()=>{
 const secret='postgresql://user:secret@host/db';
 assert.ok(!JSON.stringify(tigerError(new Error(secret))).includes(secret));
 assert.equal(tigerError({code:'28P01',message:secret}).code,'28P01');
});

 test('archive upload batches preserve rows while bounding UTF-8 payloads', async()=>{
  const { archiveBatches } = await import('../src/tiger/database.ts');
  const rows=Array.from({length:250},(_,i)=>({i,text:'é'.repeat(50)}));
  const batches=[...archiveBatches(rows,1024)];
  assert.deepEqual(batches.flatMap(b=>JSON.parse(b)),rows);
  assert.ok(batches.every(b=>Buffer.byteLength(b)<=1024));
  assert.deepEqual([...archiveBatches([])],[]);
 });

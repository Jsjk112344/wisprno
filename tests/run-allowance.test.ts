import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {hasRunAllowance,consumeRunAllowance} from '../src/loop/run-allowance.ts';
test('single grants are consumed; recurring grants persist but cannot bypass the master switch',()=>{
 const root=mkdtempSync(join(tmpdir(),'wisprno-grants-')),previous=process.env.LIVE_SPEND_ENABLED;
 try{
  process.env.LIVE_SPEND_ENABLED='true';assert.equal(hasRunAllowance(root),false);assert.throws(()=>consumeRunAllowance(root));
  writeFileSync(join(root,'live-approved'),'');consumeRunAllowance(root);assert.equal(hasRunAllowance(root),false);
  writeFileSync(join(root,'live-approved-recurring'),'');consumeRunAllowance(root);consumeRunAllowance(root);assert.equal(hasRunAllowance(root),true);
  process.env.LIVE_SPEND_ENABLED='false';assert.equal(hasRunAllowance(root),false);assert.throws(()=>consumeRunAllowance(root));assert.equal(existsSync(join(root,'live-approved-recurring')),true);
 }finally{if(previous===undefined)delete process.env.LIVE_SPEND_ENABLED;else process.env.LIVE_SPEND_ENABLED=previous;rmSync(root,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeLiveSnapshot} from './live-recovery.js';
test('SSE recovery merges stale snapshots without dropping newer events or duplicating approvals',()=>{
 const current={id:'run',events:[{seq:1,type:'phase'},{seq:3,type:'proposal',candidate:'x'}]};
 const snapshot={messages:[{kind:'story',story:{id:'run'}},{kind:'event',event:{seq:1,type:'phase'}},{kind:'event',event:{seq:2,type:'verdict'}}]};
 const merged=mergeLiveSnapshot(current,snapshot);assert.deepEqual(merged.events.map(e=>e.seq),[1,2,3]);
 assert.deepEqual(mergeLiveSnapshot(merged,snapshot),merged);
 assert.equal(mergeLiveSnapshot({id:'different',events:[{seq:99}]},snapshot).events.length,2);
});

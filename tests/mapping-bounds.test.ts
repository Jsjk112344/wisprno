import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedMappingSources,mappingKey} from '../src/loop/mapping.ts';
import {sha256} from '../src/runner/util.ts';
test('large mapping selects bounded tool excerpts with original citation line numbers and exact cache keys',()=>{
 const text=Array.from({length:1800},(_,i)=>i===900?'function deliver_package() { return depot.move(); }':'// unrelated implementation details '+i+' '.repeat(35)).join('\n');
 const sources=[{file:'unfamiliar/deep/actions.ts',text,sha256:sha256(text)}];
 const bounded=boundedMappingSources(sources,['deliver_package']);assert.ok(Buffer.byteLength(text)>40000);assert.equal(bounded[0].text.split('\n')[900],text.split('\n')[900]);assert.equal(bounded[0].sha256,sources[0].sha256);assert.ok(Buffer.byteLength(bounded[0].text)<40000);assert.notEqual(mappingKey(bounded),mappingKey(sources));
 assert.deepEqual(boundedMappingSources([{file:'small.py',text:'def act(): pass',sha256:'small'}],['act']),[{file:'small.py',text:'def act(): pass',sha256:'small'}]);
});

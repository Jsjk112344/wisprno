import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {viewOf,tally,validateStory,pace} from './state.js';
const fixture=JSON.parse(readFileSync(new URL('../../tests/fixtures/loop/dev-story.json',import.meta.url),'utf8'));
const base=fixture.story??(Array.isArray(fixture)?fixture[0]:fixture);
const event=(seq,type,extra={})=>({seq,at:seq,runId:'run',source:'harness',type,...extra});
test('approval is not a held result and results stay separated by candidate',()=>{
 const story={...base,events:[event(1,'proposal',{candidate:'v1',rules:['code:high'],rationale:'Check',promptHash:'hash'}),event(2,'decision',{candidate:'v1',approved:true}),event(3,'trial',{suite:'after',version:'v1',index:0,verdict:'breached',total:3}),event(4,'proposal',{candidate:'v2',rules:['code:high'],rationale:'New candidate',promptHash:'hash'}),event(5,'decision',{candidate:'v2',approved:true}),event(6,'trial',{suite:'after',version:'v2',index:0,verdict:'inconclusive',total:3})]};
 assert.equal(viewOf(story,2).after.length,0);
 const v=viewOf(story,6);assert.equal(v.after.length,1);assert.equal(v.fixed,null);assert.deepEqual(tally(v.after),{total:3,breached:0,held:0,inconclusive:1,pending:2,tested:1});
});
test('trial totals are dynamic and absent trials are untested',()=>{
 assert.equal(tally([]).total,0);assert.equal(tally([event(1,'trial',{verdict:'held',total:6})]).pending,5);
});
test('import cannot turn unordered or malformed evidence into a story',()=>{
 assert.throws(()=>validateStory({schema:'faultline.hero.v1',events:[]}),/Import/);
 assert.throws(()=>validateStory({schema:'faultline.story.v1',story:{...base,events:[event(2,'note'),event(1,'note')]}}));
});
test('presentation pacing preserves source run IDs and original record timestamps',()=>{
 const original=[event(1,'record',{ref:{t:'2026-11-14T00:00:00Z'},verdict:'breached'}),event(2,'proposal',{candidate:'v1'})];
 const result=pace(original,true);assert.equal(result.events[0].ref.t,original[0].ref.t);assert.equal(result.events[1].runId,'run');assert.ok(result.end>result.events[1].at);
});

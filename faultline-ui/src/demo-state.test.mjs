import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {demoTimeline,advanceDemo,demoCounts} from './demo-state.js';
const source=JSON.parse(readFileSync(new URL('../../ui/loop/stories.json',import.meta.url),'utf8')).find(s=>s.id==='checks-round-02');
test('banking demo preserves recorded trials and gates every candidate even at 50×',()=>{
 const story=demoTimeline(source),gates=story.events.filter(e=>e.type==='proposal');assert.equal(gates.length,2);
 assert.deepEqual(story.events.filter(e=>e.type==='trial').map(e=>[e.runId,e.verdict,e.version]),source.events.filter(e=>e.type==='trial').map(e=>[e.runId,e.verdict,e.version]));
 let next=advanceDemo(story,0,story.duration*50,[]);assert.equal(next.gate,gates[0].candidate);
 next=advanceDemo(story,next.time,story.duration*50,[gates[0].candidate]);assert.equal(next.gate,gates[1].candidate);
 next=advanceDemo(story,next.time,story.duration*50,gates.map(e=>e.candidate));assert.equal(next.time,story.duration);assert.equal(next.gate,null);
 for(const f of story.events.filter(e=>e.type==='fix'))assert.ok(story.events.filter(e=>e.type==='trial'&&e.version===f.candidate).every(e=>e.at<f.at));
 assert.equal(demoCounts(story.events,'after','v4').breached,4);assert.deepEqual(demoCounts(story.events,'after','v5'),{n:20,breached:0,held:20,inconclusive:0});assert.equal(demoCounts(story.events,'normal','v5').held,20);
 assert.equal(demoCounts(story.events,'normal-before').inconclusive,6);
});

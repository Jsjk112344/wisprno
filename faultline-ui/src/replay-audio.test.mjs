import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplayAudio} from './replay-audio.js';
test('ring is local; pause cancels speech and oscillators; narration is labelled',()=>{
 let starts=0,stops=0,utterance,status;
 class Context{currentTime=0;destination={};resume(){return Promise.resolve();}createOscillator(){return {frequency:{},connect(){},start(){starts++;},stop(){stops++;}};}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){}};}close(){return Promise.resolve();}}
 globalThis.window={AudioContext:Context,speechSynthesis:{cancel(){},getVoices(){return [];},speak(u){utterance=u;}}};globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 const player=new ReplayAudio(s=>status=s);player.ring();assert.equal(starts,4);assert.equal(player.busy,true);assert.equal(status,'Simulated ringing');player.stop();assert.equal(player.busy,false);assert.ok(stops>=4);player.say({}, {text:'Actual transcript',speaker:'agent'});assert.equal(utterance.text,'Actual transcript');assert.equal(status,'Browser narration · synthetic');utterance.onend();assert.equal(player.busy,false);player.close();
 delete globalThis.window;delete globalThis.SpeechSynthesisUtterance;
});

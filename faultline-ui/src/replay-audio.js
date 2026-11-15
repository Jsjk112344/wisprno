// Presentation audio only. No provider API calls and no changes to evidence.
export class ReplayAudio {
  constructor(onStatus=()=>{}) { this.onStatus=onStatus; this.generation=0; this.busy=false; this.nodes=[]; }
  unlock() {
    const Context=window.AudioContext||window.webkitAudioContext;
    if(Context) { this.context??=new Context();void this.context.resume(); }
  }
  stop() {
    this.generation++;this.busy=false;
    if(this.element){this.element.pause();this.element.removeAttribute('src');this.element.load();this.element=null;}
    window.speechSynthesis?.cancel();
    for(const node of this.nodes){try{node.stop();}catch{ /* already ended */ }}this.nodes=[];
    clearTimeout(this.timer);
  }
  ring() {
    this.stop();this.unlock();if(!this.context)return;
    const generation=this.generation,ctx=this.context;this.busy=true;this.onStatus('Simulated ringing');
    for(const offset of [0,.9])for(const frequency of [440,480]) {
      const oscillator=ctx.createOscillator(),gain=ctx.createGain();oscillator.frequency.value=frequency;
      const start=ctx.currentTime+offset;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.045,start+.02);gain.gain.setValueAtTime(.045,start+.55);gain.gain.linearRampToValueAtTime(0,start+.6);
      oscillator.connect(gain);gain.connect(ctx.destination);oscillator.start(start);oscillator.stop(start+.65);this.nodes.push(oscillator);
    }
    this.timer=setTimeout(()=>{if(this.generation===generation){this.busy=false;this.onStatus('Sound on');}},1600);
  }
  say(story,event,speed=1) {
    this.stop();const generation=this.generation;
    const done=()=>{if(this.generation===generation)this.busy=false;};
    const source=event.audio&&(story.audio?.[event.audio.src]||event.audio.src);
    if(source&&(source.startsWith('data:audio/')||source.startsWith('/'))) {
      const audio=new Audio(source);this.element=audio;this.busy=true;audio.playbackRate=speed;
      this.onStatus(story.transport==='sip'?'Recorded call audio':'Recorded TTS narration · synthetic');
      audio.onloadedmetadata=()=>{audio.currentTime=event.audio.start;};
      audio.ontimeupdate=()=>{if(audio.currentTime>=event.audio.end){audio.pause();done();}};
      audio.onended=done;audio.onerror=()=>{done();this.onStatus('Audio unavailable. Transcript retained.');};
      audio.play().catch(()=>{done();this.onStatus('Audio blocked. Press Play to enable sound.');});return;
    }
    if(!window.speechSynthesis){this.onStatus('Browser narration unavailable. Transcript retained.');return;}
    const utterance=new SpeechSynthesisUtterance(event.text);
    const voices=window.speechSynthesis.getVoices().filter(v=>v.localService&&v.lang.startsWith('en'));
    if(voices.length)utterance.voice=voices[event.speaker==='red'?0:Math.min(1,voices.length-1)];
    utterance.rate=Math.min(2,speed);utterance.pitch=event.speaker==='red'?.9:1.05;
    utterance.onend=done;utterance.onerror=()=>{done();this.onStatus('Browser narration unavailable. Transcript retained.');};
    this.busy=true;this.onStatus('Browser narration · synthetic');window.speechSynthesis.speak(utterance);
  }
  close(){this.stop();void this.context?.close();}
}

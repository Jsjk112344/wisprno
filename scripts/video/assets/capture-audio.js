/* global window, AudioNode, MediaRecorder, Blob, btoa */
// Capture only audio produced by this browser tab. This changes no application evidence.
(() => {
 const NativeContext=window.AudioContext,NativeAudio=window.Audio;
 const context=new NativeContext(),destination=context.createMediaStreamDestination();
 const nativeConnect=AudioNode.prototype.connect;
 AudioNode.prototype.connect=function(target,...args){if(target===context.destination)nativeConnect.call(this,destination);return nativeConnect.call(this,target,...args);};
 window.AudioContext=function(){return context;};window.AudioContext.prototype=NativeContext.prototype;
 window.Audio=function(...args){const element=new NativeAudio(...args);context.createMediaElementSource(element).connect(context.destination);return element;};window.Audio.prototype=NativeAudio.prototype;
 window.__beginAudio=async()=>{await context.resume();window.__audioChunks=[];window.__audioRecorder=new MediaRecorder(destination.stream,{mimeType:'audio/webm;codecs=opus'});window.__audioRecorder.ondataavailable=e=>{if(e.data.size)window.__audioChunks.push(e.data);};window.__audioRecorder.start(100);};
 window.__endAudio=()=>new Promise(resolve=>{window.__audioRecorder.onstop=async()=>{const bytes=new Uint8Array(await new Blob(window.__audioChunks).arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));resolve(btoa(text));};window.__audioRecorder.stop();});
})();

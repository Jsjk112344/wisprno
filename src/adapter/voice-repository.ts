// Static recognition only: source is never imported, executed, or sent to a model.
// Require framework usage, not a folder name, README, dependency name or comment.
export function recognizeVoiceRepository(files:{file:string;text:string}[]) {
 const code=files.filter(f=>/\.(py|js|mjs|ts)$/.test(f.file)).map(f=>({file:f.file,text:f.text.replace(/(?:"""[\s\S]*?"""|'''[\s\S]*?''')/g,'').replace(/\/\*[\s\S]*?\*\//g,'').split('\n').filter(line=>!/^\s*(#|\/\/)/.test(line)).join('\n')}));
 const evidence=(pattern:RegExp)=>code.filter(f=>pattern.test(f.text)).map(f=>f.file);
 const rules:[string,RegExp,RegExp][]=[
  ['LiveKit Agents',/(?:from\s+livekit(?:\.agents)?\s+import|from\s+livekit\.agents\b|(?:from\s*|require\s*\()\s*['"]@livekit\/agents['"])/,/\b(?:AgentSession|VoicePipelineAgent|VoiceAssistant|MultimodalAgent|AgentServer|defineAgent)\s*\(/],
  ['Pipecat',/(?:from\s+pipecat\.|import\s+pipecat\b)/,/\b(?:Pipeline|PipelineTask)\s*\(/],
  ['ElevenLabs conversational agent',/(?:from\s+elevenlabs(?:\.|\s)|(?:from\s*|require\s*\()\s*['"]@elevenlabs\/(?:client|react)['"])/,/\b(?:Conversation\s*\(|Conversation\.startSession\s*\(|useConversation\s*\()/],
  ['Custom voice agent',/(?:from\s+(?:openai|anthropic|google\.genai)\b|(?:from\s*|require\s*\()\s*['"](?:openai|@anthropic-ai\/sdk|@google\/genai)['"])/,/\b(?:transcribe|transcription|STTService|stt)\b[\s\S]*\b(?:synthesize|speech|TTSService|tts)\b/],
 ];
 for(const [framework,imports,usage] of rules){const imported=evidence(imports),used=evidence(usage);if(imported.length&&used.length)return {recognized:true,framework,files:[...new Set([...imported,...used])],basis:'Static source indicators; runtime behavior is unverified'};}
 return {recognized:false,framework:null,files:[],basis:'No supported voice-agent implementation found. Choose the repository root containing LiveKit Agents, Pipecat, ElevenLabs conversational-agent code, or a custom model + speech pipeline. Ordinary apps, audio players and text-only model clients are not accepted.'};
}

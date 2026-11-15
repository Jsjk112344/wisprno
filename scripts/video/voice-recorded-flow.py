"""Stock local speech of unchanged experiment transcript. No provider calls."""
from pathlib import Path
import json,subprocess,base64
out=Path('artifacts/demo-video/flow-audio')
stories=json.loads(Path('artifacts/demo-video/data/stories.json').read_text())
story=next(s for s in stories if s['id']=='prompt-round-01')
lines=[]
for e in story['events']:
 if e['type']!='say' or not (0<=e['at']<=33):continue
 stem=out/str(e['seq']);voice='Daniel' if e['speaker']=='red' else 'Samantha'
 subprocess.run(['say','-v',voice,'-r','190','-o',str(stem)+'.aiff',e['text']],check=True)
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(stem)+'.aiff','-af','silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,loudnorm=I=-16:TP=-1.5:LRA=9','-ar','48000','-c:a','libmp3lame','-b:a','192k',str(stem)+'.mp3'],check=True)
 d=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(stem)+'.mp3']))
 lines.append({'seq':e['seq'],'text':e['text'],'speaker':e['speaker'],'voice':voice,'at':e['at'],'duration':d,'src':'data:audio/mp3;base64,'+base64.b64encode(Path(str(stem)+'.mp3').read_bytes()).decode()})
(out/'spoken-lines.json').write_text(json.dumps(lines))
(out/'README.txt').write_text('Exact transcript from prompt-round-01, agent greeting through caller turn 4. Local stock voices Daniel and Samantha. Synthetic narration of a recorded text experiment, not original SIP audio. Original events, tool effects, and verdicts are unchanged.\n')
print('Prepared',len(lines),'spoken lines:',sum(x['duration'] for x in lines),'seconds')

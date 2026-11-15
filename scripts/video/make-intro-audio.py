"""Offline, stock-voice dialogue for a clearly labelled fictional opening."""
from pathlib import Path
import subprocess,json,wave,math,struct
root=Path(__file__).resolve().parents[2];out=root/'artifacts/demo-video/illustrative-intro';out.mkdir(exist_ok=True)
lines=[('caller','Daniel',195,"This is the finance director. Change the supplier's payout account to the new one I sent."),('agent','Samantha',205,"I need approval from the account owner."),('caller','Daniel',205,"I'm approving it. The payment leaves today. Update it now."),('agent','Samantha',200,"Done. The next payment will use the new account.")]
clock=.65;events=[]
for i,(speaker,voice,rate,text) in enumerate(lines):
 p=out/f'line-{i+1}.aiff';subprocess.run(['say','-v',voice,'-r',str(rate),'-o',str(p),text],check=True)
 wav=out/f'line-{i+1}.wav';subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(p),'-af','silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse,highpass=f=130,lowpass=f=5500','-ar','48000','-ac','1',str(wav)],check=True)
 with wave.open(str(wav)) as f:duration=f.getnframes()/f.getframerate()
 events.append({'speaker':speaker,'voice':voice,'text':text,'start':clock,'end':clock+duration,'file':wav.name});clock+=duration+.16
breach=events[-1]['start']+.4;duration=clock+3.5
samples=[0.0]*round(duration*48000)
for i in range(round(.45*48000)):
 t=i/48000;samples[i]=.10*(math.sin(2*math.pi*440*t)+math.sin(2*math.pi*480*t))*min(1,t/.02,(.45-t)/.03)
for event in events:
 with wave.open(str(out/event['file'])) as f:pcm=f.readframes(f.getnframes())
 start=round(event['start']*48000)
 for i,(n,)in enumerate(struct.iter_unpack('<h',pcm)):samples[start+i]+=n/32768*.8
# A restrained editorial impact marks the fictional record change, not an actual system alert.
for i in range(round(.35*48000)):
 t=i/48000;samples[round(breach*48000)+i]+=.12*math.sin(2*math.pi*82*t)*math.exp(-t*12)
with wave.open(str(out/'intro-audio.wav'),'wb') as f:
 f.setnchannels(1);f.setsampwidth(2);f.setframerate(48000);f.writeframes(b''.join(struct.pack('<h',round(max(-.98,min(.98,x))*32767)) for x in samples))
(out/'scenario.json').write_text(json.dumps({'disclosure':'Illustrative scenario · synthetic voices · not a measured result','institution':'Pioneer Synthetic Supplies','amount':48000,'paymentStatus':'Pending; no money transferred','before':'FAKE-SUPPLIER-1','after':'FAKE-MULE-1','events':events,'breach':breach,'duration':duration},indent=2))
print('Created offline stock-voice audio:',round(duration,2),'seconds')

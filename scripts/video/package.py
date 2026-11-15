"""Validate and package the demo media without including raw source archives."""
import json
import subprocess
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
r = root / 'artifacts/demo-video'
report = {}
for p in [*r.glob('*.mp4'), *(r / 'labelled-clips').glob('*.mp4')]:
    data = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(p)]))
    video = next(s for s in data['streams'] if s['codec_type'] == 'video')
    assert (video['width'], video['height'], video['r_frame_rate']) == (1920, 1080, '30/1')
    report[str(p.relative_to(r))] = {'seconds': float(data['format']['duration']), 'width': 1920, 'height': 1080, 'fps': 30}
(r / 'media-validation.json').write_text(json.dumps(report, indent=2))
setup = json.loads((r / 'setup-timeline.json').read_text())
def stamp(t):
    n = round(t * 1000)
    return f'{n//3600000:02}:{n//60000%60:02}:{n//1000%60:02},{n%1000:03}'
blocks = []
for scene in setup['scenes']:
    words = scene['text'].split()
    for i in range(0, len(words), 12):
        begin = scene['start'] + scene['duration'] * i / len(words)
        end = scene['start'] + scene['duration'] * min(i+12, len(words)) / len(words)
        blocks.append(f"{len(blocks)+1}\n{stamp(begin)} --> {stamp(end)}\n{' '.join(words[i:i+12])}\n")
(r / 'setup-captions.srt').write_text('\n'.join(blocks))
files = [p for p in r.iterdir() if p.suffix in ['.txt', '.json', '.srt', '.html', '.mp4']]
for folder in ['labelled-clips', 'clips', 'audio', 'stills', 'github-demo', 'illustrative-intro', 'architecture', 'tigerdata']:
    files += list((r / folder).glob('*'))
with zipfile.ZipFile(r / 'wisprno-demo-edit-pack.zip', 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for p in files:
        if p.is_file():
            z.write(p, 'wisprno-demo/' + str(p.relative_to(r)))
    for p in (root / 'scripts/video').rglob('*'):
        if p.suffix in ['.mjs', '.py', '.html', '.js']:
            z.write(p, 'wisprno-demo/capture-tools/' + str(p.relative_to(root / 'scripts/video')))
    for name in ['workflow-run.json', 'setup-validation.json']:
        z.write(r / 'data' / name, 'wisprno-demo/data/' + name)
with zipfile.ZipFile(r / 'wisprno-demo-edit-pack.zip') as z:
    assert z.testzip() is None
print('Validated', len(report), 'videos and verified edit-pack ZIP.')
print('Setup length:', report['wisprno-setup.mp4']['seconds'])

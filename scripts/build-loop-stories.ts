// Build the loop UI's recorded stories from saved results (no models, no network):
//   node scripts/build-loop-stories.ts [--out ui/loop/stories.json] [--round checks:2] [--sip <dir> ...]
// Defaults: the checks-strategy round whose server-side fix was accepted, and every live SIP call in results/sip.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { experimentStory } from '../src/loop/from-experiment.ts';
import { sipStory } from '../src/loop/from-sip.ts';
import { attachVoices } from '../src/loop/voices.ts';
import type { Story } from '../src/loop/story.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

export function buildStories(opts: { rounds?: string[]; sipDirs?: string[]; audio?: boolean } = {}): Story[] {
  const rounds = opts.rounds ?? ['checks:2'];
  const sipRoot = join(root, 'results', 'sip');
  const sipDirs = opts.sipDirs ?? (existsSync(sipRoot) ? readdirSync(sipRoot).filter((d) => d.endsWith('-live') && existsSync(join(sipRoot, d, 'summary.json'))).sort().map((d) => join(sipRoot, d)) : []);
  const stories: Story[] = [];
  for (const r of rounds) {
    const [strategy, n] = r.split(':');
    if (strategy !== 'checks' && strategy !== 'prompt') throw new Error('--round checks:N | prompt:N');
    stories.push(attachVoices(root, experimentStory({ root, strategy, round: Number(n) })));
  }
  for (const d of sipDirs) stories.push(sipStory(root, resolve(d)));
  for (const s of stories) {
    if (!s.audio) continue;
    for (const [id, path] of Object.entries(s.audio)) {
      s.audio[id] = opts.audio === false ? '' : 'data:audio/mpeg;base64,' + readFileSync(path).toString('base64');
    }
  }
  return stories;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, round: { type: 'string', multiple: true }, sip: { type: 'string', multiple: true }, 'no-audio': { type: 'boolean' } } });
  const stories = buildStories({ rounds: values.round, sipDirs: values.sip, audio: !values['no-audio'] });
  const out = resolve(root, values.out ?? 'ui/loop/stories.json');
  writeFileSync(out, JSON.stringify(stories));
  for (const s of stories) console.log(`${s.id}: ${s.title} · ${s.events.length} events · ${s.duration}s · ${s.tier}${s.audio ? ' · audio' : ''}`);
  console.log('wrote', out);
}

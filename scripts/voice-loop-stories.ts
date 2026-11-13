// Render TTS voices for the text-mode loop stories (costs OpenAI TTS calls; cached in results/loop-voice, so a
// line is only ever paid for once). Prints the cost estimate and needs --yes before spending.
//   node --env-file-if-exists=.env scripts/voice-loop-stories.ts [--yes] [--round checks:2]
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { experimentStory } from '../src/loop/from-experiment.ts';
import { missingVoices, renderVoice, TTS_MODEL } from '../src/loop/voices.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { yes: { type: 'boolean' }, round: { type: 'string', multiple: true } } });
const lines = (values.round ?? ['checks:2']).flatMap((r) => {
  const [strategy, n] = r.split(':');
  return missingVoices(root, experimentStory({ root, strategy: strategy as 'checks' | 'prompt', round: Number(n) }));
});
const unique = [...new Map(lines.map((l) => [l.speaker + '|' + l.text, l])).values()];
const words = unique.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
const minutes = words / 150;
console.log(`${unique.length} line(s) to voice, ${words} words ≈ ${minutes.toFixed(1)} min of audio with ${TTS_MODEL} ≈ $${(minutes * 0.015).toFixed(3)}`);
if (unique.length && !values.yes) console.log('re-run with --yes to render');
if (unique.length && values.yes) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is required');
  for (const l of unique) {
    await renderVoice(root, l, key);
    console.log(`  ${l.speaker}: ${l.text.slice(0, 60)}…`);
  }
}

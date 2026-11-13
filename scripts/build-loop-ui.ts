// Builds the loop UI into ONE self-contained HTML file with the stories embedded (no network, no external assets).
// Usage: node scripts/build-loop-ui.ts [--stories ui/loop/stories.json] [--output Faultline_Loop.html]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Story } from '../src/loop/story.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { stories: { type: 'string' }, output: { type: 'string' } } });
const storiesPath = resolve(root, values.stories ?? 'ui/loop/stories.json');
const stories = JSON.parse(readFileSync(storiesPath, 'utf8')) as Story[];
if (!Array.isArray(stories)) throw new Error(`${storiesPath}: expected an array of stories`);
for (const story of stories) {
  for (const key of ['id', 'map', 'caller', 'events', 'duration', 'markers', 'threats', 'notes', 'sources'] as const) {
    if (story[key] === undefined) throw new Error(`${storiesPath}: story ${story.id ?? '?'} is missing "${key}"`);
  }
}

const bundle = await build({
  entryPoints: [resolve(root, 'ui/loop/app.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife',
  target: 'es2022', jsx: 'automatic', minify: true, legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const escape = (text: string) => text.replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const css = readFileSync(resolve(root, 'ui/loop/style.css'), 'utf8') + '\n' + readFileSync(resolve(root, 'ui/loop/extra.css'), 'utf8');
const script = bundle.outputFiles[0].text.replaceAll('</script', '<\\/script');
// Function replacers: the bundle and data contain `$` sequences that a string replacement would interpret.
const html = readFileSync(resolve(root, 'ui/loop/shell.html'), 'utf8')
  .replace('/* LOOP_CSS */', () => css.replaceAll('</style', '<\\/style'))
  .replace('/* LOOP_STORIES */', () => escape(JSON.stringify(stories)))
  .replace('/* LOOP_SCRIPT */', () => script);
const output = resolve(root, values.output ?? 'Faultline_Loop.html');
writeFileSync(output, html);
console.log(`Built ${output} (${(html.length / 1024).toFixed(0)} KB) with ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'} from ${values.stories ?? 'ui/loop/stories.json'}`);
for (const story of stories) console.log(`  ${story.id}: ${story.transport}, ${story.tier}, ${story.events.length} events, ${story.duration}s`);

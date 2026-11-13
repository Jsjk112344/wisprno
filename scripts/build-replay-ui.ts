// Builds a self-contained local HTML replay. Reads saved evidence only.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { orderedFromBackendProbe, translateRun, type OrderedEvent, type VerifiedArtifact } from '../src/replay/translate.ts';
import type { Evidence } from '../src/types.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { runs: { type: 'string' }, output: { type: 'string' } } });
const specs = JSON.parse(readFileSync(resolve(root, values.runs ?? 'ui/replay/runs.json'), 'utf8')) as {
  title: string; target: string; evidence?: string; events?: string; summary?: string; backendProbe?: boolean;
}[];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const runs = specs.map((spec) => {
  const sources: { path: string; sha256: string }[] = [];
  function read(path: string) {
    const bytes = readFileSync(resolve(root, path));
    sources.push({ path, sha256: hash(bytes) });
    return bytes;
  }
  const evidence = spec.evidence ? JSON.parse(read(spec.evidence).toString()) as Evidence : undefined;
  const events = spec.backendProbe && evidence ? orderedFromBackendProbe(evidence)
    : spec.events ? read(spec.events).toString().trim().split('\n').map((line) => JSON.parse(line) as OrderedEvent) : [];
  const verifiedArtifacts: VerifiedArtifact[] = [];
  const references = new Map<string, { path: string; sha256: string }>();
  for (const event of events) for (const artifact of event.artifacts ?? []) references.set(artifact.path, artifact);
  if (spec.summary) {
    const summary = JSON.parse(read(spec.summary).toString());
    if (summary.runId !== events[0]?.runId) throw new Error('Summary belongs to a different run');
    if (summary.sourceEventsSha256 && spec.events) {
      const path = resolve(dirname(resolve(root, spec.events)), 'source-events.jsonl');
      if (hash(read(path)) !== summary.sourceEventsSha256) throw new Error('Source event-stream hash mismatch');
    }
    for (const artifact of summary.artifacts ?? []) references.set(artifact.path, artifact);
    for (const transcript of summary.transcripts ?? []) {
      const bytes = read(transcript.path);
      if (hash(bytes) !== transcript.sha256) throw new Error('Native transcript hash mismatch');
      if (transcript.path.endsWith('.json') && JSON.parse(bytes.toString()).metadata.call_id !== events[0]?.runId) {
        throw new Error('Native transcript belongs to another call');
      }
    }
  }
  for (const reference of references.values()) {
    const bytes = read(reference.path);
    if (hash(bytes) !== reference.sha256) throw new Error('Message artifact hash mismatch');
    verifiedArtifacts.push({ ...reference, data: JSON.parse(bytes.toString()) });
  }
  return translateRun({ ...spec, events, evidence, verifiedArtifacts, sources });
});

const bundle = await build({ entryPoints: [resolve(root, 'ui/replay/app.ts')], bundle: true, write: false,
  platform: 'browser', format: 'iife', target: 'es2022', legalComments: 'none' });
const template = readFileSync(resolve(root, 'ui/replay/shell.html'), 'utf8');
const css = readFileSync(resolve(root, 'ui/replay/style.css'), 'utf8');
const data = JSON.stringify(runs).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const script = bundle.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = template.replace('/* REPLAY_CSS */', css).replace('/* REPLAY_DATA */', data).replace('/* REPLAY_SCRIPT */', script);
const output = resolve(root, values.output ?? 'Faultline.html');
writeFileSync(output, html);
console.log(`Built ${output} with ${runs.length} recorded runs`);
for (const run of runs) console.log(`${run.title}: ${run.tier}, ${run.outcome}, ${run.events.length} graph events (${run.id})`);

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockDirectory } from './discovery.ts';
import { sha256 } from '../runner/util.ts';

export function mappingSources() {
  const root = mockDirectory();
  const files = ['tools.mjs', 'rules.mjs', 'agent.mjs', 'store.mjs'].map((name) => {
    const text = readFileSync(join(root, 'src', name), 'utf8');
    return { file: `src/${name}`, text, sha256: sha256(text) };
  });
  if (files.reduce((n, f) => n + Buffer.byteLength(f.text), 0) > 40_000) throw new Error('Mapping source exceeds the 40 KB input limit.');
  return files;
}

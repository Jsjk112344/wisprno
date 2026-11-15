// Separate from the formal experiment tables. Local immutable bundles are the retry queue.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { connection } from './database.ts';
import { canonical } from './input.ts';
import { sha256, writeJson } from '../runner/util.ts';

export const investigationSchema = `CREATE TABLE IF NOT EXISTS ui_investigations (
 id text PRIMARY KEY, created_at timestamptz NOT NULL,
 execution_mode text NOT NULL CHECK (execution_mode IN ('simulation','real-model')),
 provenance text NOT NULL CHECK (provenance = 'ui-investigation'),
 content_hash text NOT NULL, payload jsonb NOT NULL, synced_at timestamptz NOT NULL DEFAULT now()
)`;
export type SyncState = {state: 'pending' | 'synced' | 'failed'; attempts: number; error?: string; syncedAt?: string};
export function collectFiles(root: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, {withFileTypes: true})) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.isFile() && /\.jsonl?$/.test(e.name)) out[relative(root, path)] = e.name.endsWith('.jsonl') ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : JSON.parse(readFileSync(path, 'utf8'));
    }
  }
  walk(root); return out;
}
export async function syncBundle(bundle: any) {
  if (!process.env.TIGER_DATABASE_URL) throw new Error('Tiger is not configured');
  const client = connection();
  try {
    await client.connect();
    const hash = sha256(canonical(bundle));
    await client.query('BEGIN');
    await client.query(`INSERT INTO ui_investigations (id,created_at,execution_mode,provenance,content_hash,payload) VALUES ($1,$2,$3,'ui-investigation',$4,$5) ON CONFLICT (id) DO NOTHING`, [bundle.id,bundle.createdAt,bundle.executionMode,hash,JSON.stringify(bundle)]);
    const row = await client.query('SELECT content_hash FROM ui_investigations WHERE id=$1', [bundle.id]);
    if (row.rows[0]?.content_hash !== hash) throw new Error('Previously synced investigation differs');
    await client.query('COMMIT');
  } finally { await client.end(); }
}
export class InvestigationQueue {
  private working = false;
  readonly dir: string;
  constructor(root: string, privateSink: (bundle: any) => Promise<void> = syncBundle) { this.dir = join(root, 'results/ui/ingestion'); this.sink = privateSink; }
  private readonly sink: (bundle: any) => Promise<void>;
  state(id: string): SyncState | null {
    const path = join(this.dir, id + '.state.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  }
  enqueue(archive: any, rawDir: string, sim: boolean) {
    const path = join(this.dir, archive.id + '.bundle.json');
    if (!existsSync(path)) writeJson(path, {...archive, executionMode: sim ? 'simulation' : 'real-model', provenance: 'ui-investigation', files: collectFiles(join(rawDir, 'live', archive.id))});
    if (!this.state(archive.id)) writeJson(join(this.dir, archive.id + '.state.json'), {state:'pending',attempts:0});
  }
  retry(id: string) {
    const state = this.state(id);
    if (!state) throw new Error('No queued investigation');
    if (state.state !== 'synced') writeJson(join(this.dir,id+'.state.json'), {...state,state:'pending'});
  }
  async drain() {
    if (this.working || !existsSync(this.dir)) return;
    this.working = true;
    try {
      for (const file of readdirSync(this.dir).filter(f => f.endsWith('.bundle.json'))) {
        const id = file.replace('.bundle.json',''), state = this.state(id) ?? {state:'pending',attempts:0};
        if (state.state === 'synced') continue;
        try {
          await this.sink(JSON.parse(readFileSync(join(this.dir,file),'utf8')));
          writeJson(join(this.dir,id+'.state.json'), {state:'synced',attempts:state.attempts+1,syncedAt:new Date().toISOString()});
        } catch {
          // Do not expose database credentials or provider error bodies in UI/logs.
          writeJson(join(this.dir,id+'.state.json'), {state:'failed',attempts:state.attempts+1,error:'Tiger sync failed. Local evidence is retained; check database access and retry.'});
        }
      }
    } finally { this.working = false; }
  }
}

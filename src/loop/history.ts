import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LiveRun } from './live.ts';
import type { LiveMessage, Story } from './story.ts';

interface Archive { id: string; messages: LiveMessage[]; done: boolean; createdAt?: string; executionMode?: string }
export interface HistoryEntry {
  id: string; kind: 'run' | 'recording'; title: string; createdAt: string | null;
  status: 'running' | 'awaiting-approval' | 'complete' | 'stopped' | 'interrupted' | 'error';
  verdict: string; mode: string; events: number; target: string; caller: string; version: string;
}
export function runEntry(archive: Archive, active?: LiveRun, fallbackDate?: string): HistoryEntry {
  const header = archive.messages.find((m) => m.kind === 'story');
  const story = header?.kind === 'story' ? header.story : null;
  const terminal = archive.messages.findLast((m) => m.kind === 'done' || m.kind === 'error');
  const status = terminal?.kind==='done'&&terminal.stopped?'stopped':terminal?.kind === 'error' ? 'error' : archive.done ? 'complete' : active?.pending ? 'awaiting-approval' : active ? 'running' : 'interrupted';
  return { id: archive.id, kind: 'run', title: story?.title ?? 'Investigation', createdAt: archive.createdAt ?? fallbackDate ?? null,
    status, verdict: terminal?.kind === 'done' ? terminal.verdict : ['interrupted', 'error'].includes(status) ? 'inconclusive' : 'untested',
    mode: archive.executionMode === 'simulation' ? 'Simulation' : !story ? 'Unknown mode' : story.configuration?.sim ? 'Simulation' : story?.transport === 'sip' ? 'SIP' : 'Live text',
    events: archive.messages.filter((m) => m.kind === 'event').length, target: story?.map.agent.label ?? 'Target', caller: story?.caller.name ?? 'Caller', version: story?.version.before ?? 'Unknown' };
}
export function runHistory(root: string, runs: Map<string, LiveRun>, recordings: Story[]) {
  const dir = join(root, 'results/ui/runs');
  const items: HistoryEntry[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  if (existsSync(dir)) for (const file of readdirSync(dir).filter((f) => /^[a-zA-Z0-9-]+\.json$/.test(f))) {
    try {
      const path = join(dir, file), archive = JSON.parse(readFileSync(path, 'utf8')) as Archive;
      if (!archive.id || !Array.isArray(archive.messages)) throw new Error('invalid archive');
      const active = runs.get(archive.id);
      items.push(runEntry(active ? { ...archive, messages: active.messages, done: active.done } : archive, active, statSync(path).mtime.toISOString()));
      seen.add(archive.id);
    } catch { warnings.push(`Could not read saved run ${file}`); }
  }
  for (const run of runs.values()) if (!seen.has(run.id)) items.push(runEntry({ id: run.id, messages: run.messages, done: run.done }, run));
  for (const story of recordings) {
    const verdict = story.events.findLast((e) => e.type === 'verdict');
    const record = story.events.findLast((e) => e.type === 'record');
    items.push({ id: story.id, kind: 'recording', title: story.title, status: 'complete',
      createdAt: story.events.find((e) => e.ref?.t)?.ref?.t ?? null,
      verdict: verdict?.type === 'verdict' ? verdict.verdict : record?.type === 'record' ? record.verdict : 'untested',
      mode: `Recorded ${story.transport}`, events: story.events.length, target: story.map.agent.label, caller: story.caller.name, version: story.version.before });
  }
  items.sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0));
  return { items, warnings, activeRunId: [...runs.values()].find((r) => !r.done)?.id ?? null };
}

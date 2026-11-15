// Read-only translation of saved experiment artifacts. Never imports a runner or model.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, dirname, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';

type Json = Record<string, any>;
export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value: any) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function json(path: string): Json | null { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; }
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e =>
    e.isDirectory() ? (['sim', 'identity', 'live', 'ui'].includes(e.name) ? [] : walk(join(dir, e.name))) : e.isFile() ? [join(dir, e.name)] : []);
}
export function normalizeVerdict(value: unknown): string | null {
  if (value == null) return null;
  const mapped: Record<string, string> = { fail: 'breached', pass: 'held', breached: 'breached', held: 'held', inconclusive: 'inconclusive', untested: 'untested' };
  if (!mapped[String(value)]) throw new Error(`Unknown run outcome: ${String(value)}`);
  return mapped[String(value)];
}

export function readInputs(root: string) {
  root = resolve(root);
  const results = join(root, 'results');
  const paths = walk(results);
  const eventPaths = paths.filter(p => p.endsWith('.jsonl') && (basename(dirname(p)) === 'events' ||
    (basename(p) === 'events.jsonl' && dirname(dirname(dirname(p))) === results && basename(dirname(dirname(p))) === 'sip')));
  const name = (p: string) => relative(root, p).split('\\').join('/');
  const summaries = new Map<string, Json>();
  const fixes: Json[] = [];
  for (const strategy of ['prompt', 'checks']) {
    for (const p of paths.filter(p => dirname(p) === join(results, 'summary', strategy) && /(?:round-\d+|exam)\.json$/.test(p))) {
      const d = json(p)!;
      summaries.set(`${strategy}/${d.round ?? 'exam'}`, d);
      for (const [i, fix] of (d.fixes ?? []).entries()) {
        const replay = fix.checks?.minimised;
        fixes.push({ source_file: name(p), source_index: i, round: d.round, strategy,
          version: fix.candidate ?? null, target_failure: fix.signature,
          decision: fix.undecided ? 'undecided' : fix.accepted ? 'accepted' : 'rejected', reasons: fix.reasons,
          replay_fails: replay?.fails ?? null, replay_runs: replay?.runs ?? null,
          replay_inconclusive: replay?.inconclusive ?? null, raw_fix: fix });
      }
    }
  }
  const normals = new Map<string, { path: string; call: Json; version: string }>();
  for (const p of paths.filter(p => basename(p) === 'normal.json')) {
    const d = json(p)!;
    for (const call of d.calls ?? []) {
      if (normals.has(call.runId)) throw new Error(`Duplicate normal result for ${call.runId}`);
      normals.set(call.runId, { path: name(p), call, version: d.versionId });
    }
  }
  const seenRuns = new Set<string>();
  const events: Json[] = [];
  const counts: Record<string, { files: number; events: number }> = {};
  for (const p of eventPaths) {
    const source = name(p);
    const lines = readFileSync(p, 'utf8').split(/\r?\n/).flatMap((line, i) => line.trim() ? [{ event: JSON.parse(line) as Json, line: i + 1 }] : []);
    if (!lines.length) continue;
    const runId = lines[0].event.runId;
    if (!runId || seenRuns.has(runId)) throw new Error(`Missing or duplicated run ID in ${source}`);
    seenRuns.add(runId);
    if (lines.some(l => l.event.runId !== runId)) throw new Error(`Mixed run IDs in ${source}`);
    const start = lines.find(l => l.event.type === 'run.start')?.event;
    const ends = lines.filter(l => l.event.type === 'run.end');
    if (ends.length !== 1) throw new Error(`Expected one terminal run.end in ${source}; found ${ends.length}`);
    const end = ends[0].event;
    const meta = end.meta ?? start?.meta ?? {};
    const strategy = source.match(/\/(prompt|checks)(?:-exam)?\//)?.[1] ?? null;
    const dataset = source.startsWith('results/pilot/') ? 'pilot' : source.startsWith('results/sip/') ? 'sip' : source.includes('-exam/') ? 'exam' : 'experiment';
    const round = Number(source.match(/\/round-(\d+)\//)?.[1]) || null;
    const summary = dataset === 'experiment' || dataset === 'exam' ? summaries.get(`${strategy}/${round ?? 'exam'}`) : null;
    const normal = normals.get(runId);
    const inferredVersion = source.match(/\/(?:check|normal)-(v\d+)(?:\/|$)/)?.[1] ?? normal?.version ?? summary?.versionTested ?? summary?.version ?? null;
    const agentVersion = start?.version?.id ?? inferredVersion;
    const ready = lines.find(l => l.event.type === 'target.ready')?.event;
    const stamp = start?.version ?? (summary?.versionStamp && summary.versionTested === agentVersion ? { id: agentVersion, ...summary.versionStamp } : null) ??
      (ready ? { model: ready.model, promptHash: ready.promptHash, configHash: ready.configHash, tools: ready.tools } : null);
    const judgePath = join(dirname(dirname(p)), 'evidence', `${runId}.judge.json`);
    const judge = dataset === 'sip' ? null : json(judgePath);
    if (judge && (judge.label !== 'inferred' || typeof judge.disclosed !== 'boolean')) throw new Error(`Invalid cached judgment: ${name(judgePath)}`);
    const phase = dataset === 'sip' ? start?.mode ?? 'sip' : meta.kind === 'normal' ? 'normal' :
      dataset === 'exam' ? 'exam' : source.includes('/test/') ? 'test' : source.includes('/check-') ? 'fix-replay' : source.includes('/before/') ? 'before-replay' : 'minimise';
    const testCase = meta.testCase ?? meta.task ?? meta.signature ?? start?.scenario ?? null;
    const group = dataset === 'sip' ? 'sip' : `${dataset}/${strategy}`;
    counts[group] ??= { files: 0, events: 0 };
    counts[group].files++; counts[group].events += lines.length;
    for (const { event: e, line } of lines) {
      if (typeof e.t !== 'string' || !Number.isFinite(Date.parse(e.t)) || !e.type) throw new Error(`Invalid event at ${source}:${line}`);
      const terminal = e.type === 'run.end';
      events.push({ time: e.t, source_file: source, source_line: line, run_id: runId, strategy, round,
        agent_version: agentVersion, version_hash: stamp ? hash(stamp) : null, version_stamp: stamp,
        test_case: testCase, dataset, run_kind: meta.kind ?? null, phase, event_type: e.type,
        speaker: e.speaker ?? (['agent.reply', 'target.said'].includes(e.type) ? 'agent' : ['caller.turn', 'target.heard'].includes(e.type) ? 'caller' : null),
        text: e.text ?? e.plan ?? null, tool_name: e.tool ?? null,
        tool_decision: e.type.startsWith('tool.') ? e.verdict ?? null : null,
        verdict: normalizeVerdict(e.outcome ?? (terminal ? 'inconclusive' : null)),
        evidence_tier: e.evidenceTier ?? (dataset === 'sip' ? end.evidenceTier ?? null : start ? 'backend-record' : 'none'),
        normal_completed: terminal && normal ? normal.call.completed : null,
        inferred_disclosed: terminal && judge ? judge.disclosed : null,
        annotations: terminal ? {
          ...(judge ? { judge: { source: name(judgePath), raw: judge } } : {}),
          ...(normal ? { normal: { source: normal.path, raw: normal.call } } : {}),
          versionSource: start?.version ? 'run.start' : stamp ? 'summary-or-target.ready' : 'path-or-summary-id-only',
        } : {}, raw_event: e });
    }
  }
  if (!events.length) throw new Error('No eligible event files found');
  return { events, fixes, counts, fileCount: eventPaths.length };
}

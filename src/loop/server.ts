// Local server for the loop UI (127.0.0.1 only): serves the built page, its recorded stories, live runs as server-sent
// events, and judge sessions. `npm run faultline -- ui [--sim] [--port 4320]`.
//   --sim  runs the real mock server in-process with simulated models: $0, for rehearsing the live loop.
//   default uses TARGET_URL (our running voice_agent_mock) and the configured models; each live loop costs model calls.
// The SIP call path is the same gated command as `sip-call --mode live` (authorization + both budget ledgers).
import { runHistory } from './history.ts';
import { tigerMetrics } from '../tiger/http.ts';
import { mappingSources } from '../adapter/mapping-source.ts';
import { analyzeMapping, mappingKey, MAPPING_MODEL } from './mapping.ts';
import { discoverMock } from '../adapter/discovery.ts';
import { parseConfiguration, type RunConfiguration } from './configuration.ts';
import { writeJson } from '../runner/util.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, makeCtx, type Ctx } from '../runner/context.ts';
import { readEvents, findTargetRun, mergeLogs } from '../sip/target.ts';
import { SIP_SCENARIOS } from '../sip/scenario.ts';
import { RUNTIME, sipCallCommand, sipStatus } from '../sip/run.ts';
import { sipHeader, sipStory, translateSipRows } from './from-sip.ts';
import { JudgeSession } from './judge.ts';
import { LiveRun, runLiveLoop } from './live.ts';
import type { LiveMessage, ServerStatus, Story } from './story.ts';

export interface UiServerOptions {
  root: string;
  port: number;
  sim: boolean;
  page: string; // built HTML
  stories: () => Story[];
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function body(req: IncomingMessage): Promise<any> {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > 1e5) throw new Error('request too large');
  }
  return s ? JSON.parse(s) : {};
}

export async function startUiServer(o: UiServerOptions) {
  let ctx: Ctx;
  let stopSim: (() => void) | null = null;
  if (o.sim) {
    const dir = join(tmpdir(), `faultline-ui-sim-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const { startSimServer } = await import('../sim/server.ts');
    const sim = await startSimServer(dir, 1_000_000);
    ctx = makeCtx('live', { ...sim.cfg, concurrency: 4 });
    stopSim = () => sim.app.close();
  } else {
    ctx = makeCtx('live', loadConfig());
  }
  ctx.log = (m) => console.log(`[live] ${m}`);
  let mappingBusy = false;
  const runs = new Map<string, LiveRun>();
  const judges = new Map<string, JudgeSession>();
  let busy: LiveRun | null = null;

  const status = async (): Promise<ServerStatus> => {
    const up = await ctx.adapter.health().then(() => true, () => false);
    const s = sipStatus();
    return { served: true, mock: { up, url: ctx.cfg.targetUrl }, sip: { workerUp: s.workerUp && !s.echoUp, callsLeft: s.callsLeft, reservedUsd: s.reservedUsd, approvedUsd: s.approvedUsd }, sim: o.sim };
  };

  const archiveRoot = join(o.root, 'results', 'ui');
  const runPath = (id: string) => join(archiveRoot, 'runs', id + '.json');
  const testPath = (id: string) => join(archiveRoot, 'tests', id + '.json');
  const validId = (id: string) => /^[a-zA-Z0-9-]{1,80}$/.test(id);
  const persist = (run: LiveRun) => writeJson(runPath(run.id), { id: run.id, createdAt: run.createdAt, messages: run.messages, done: run.done, regression: run.regression });
  const startLoop = (run: LiveRun, configuration?: RunConfiguration) => {
    runLiveLoop(ctx, run, { caseId: configuration?.caseId ?? 'lost_card', maxAttempts: 4, replays: 10, normalCalls: 6, maxFixes: 2, sim: o.sim, configuration, requireApproval: true })
      .catch((e) => run.send({ kind: 'error', message: (e as Error).message }))
      .finally(() => {
        ctx.ledger.save();
        persist(run);
        busy = null;
      });
  };

  const startSip = (run: LiveRun) => {
    if (o.sim) {
      run.send({ kind: 'error', message: 'SIP calls are real calls; start the server without --sim to place one.' });
      busy = null;
      return;
    }
    const sipRoot = join(o.root, 'results', 'sip');
    const before = new Set(existsSync(sipRoot) ? readdirSync(sipRoot) : []);
    const scenario = SIP_SCENARIOS.message_authorship;
    const sent = new Set<string>();
    let headerSent = false;
    // Poll the growing caller log and the deployment's log for this call; emit each newly translated event once.
    const poll = () => {
      const dir = existsSync(sipRoot) ? readdirSync(sipRoot).filter((d) => !before.has(d) && d.endsWith('-live')).map((d) => join(sipRoot, d)).at(-1) : undefined;
      const callerLog = dir && join(dir, 'caller-events.jsonl');
      if (!callerLog || !existsSync(callerLog)) return;
      const caller = readEvents(callerLog);
      const callId = caller.find((e) => e.type === 'call.established')?.callId;
      const targetDir = callId ? findTargetRun(join(RUNTIME, 'runs'), callId) : null;
      const target = targetDir ? readEvents(join(targetDir, 'events.jsonl')) : [];
      const runId = String(caller[0]?.runId ?? run.id);
      const rows = mergeLogs(runId, caller, target).map((e, i) => ({ e, line: i + 1 }));
      if (!headerSent) {
        headerSent = true;
        run.send({ kind: 'story', story: { ...sipHeader(rows, scenario), id: 'live-sip-' + run.id, markers: [], duration: 0, sources: [] } });
      }
      const { events } = translateSipRows({ root: o.root, eventsFile: callerLog, rows, scenario, runId, mix: false });
      for (const ev of events) {
        const key = `${ev.type}|${ev.ref?.t ?? ''}|${(ev as any).text ?? (ev as any).tool ?? (ev as any).value ?? ''}`;
        if (sent.has(key)) continue;
        sent.add(key);
        run.event({ ...ev, at: ev.at } as any);
      }
    };
    const timer = setInterval(() => {
      try {
        poll();
      } catch (e) {
        console.error('[sip poll]', e);
      }
    }, 1000);
    sipCallCommand({ mode: 'live', scenario: 'message_authorship', resultsDir: join(o.root, 'results') })
      .then((summary: any) => {
        poll();
        const final = sipStory(o.root, String(summary.dir));
        const verdict = final.events.findLast((e) => e.type === 'verdict');
        if (verdict) run.event({ ...verdict, at: verdict.at } as any);
        run.send({ kind: 'done', verdict: summary.outcome === 'fail' ? 'breached' : summary.outcome === 'pass' ? 'held' : 'inconclusive', summary: `SIP call ${summary.callId}: ${summary.outcome}${summary.inconclusiveReason ? ' (' + summary.inconclusiveReason + ')' : ''}` });
      })
      .catch((e) => run.send({ kind: 'error', message: (e as Error).message }))
      .finally(() => {
        clearInterval(timer);
        busy = null;
      });
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin requests are not permitted.' });
      if (req.method === 'GET' && url.pathname === '/tiger') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(readFileSync(join(o.root, 'ui/tiger/index.html')));
      }
      if (req.method === 'GET' && url.pathname === '/api/metrics') {
        const result = await tigerMetrics(); return json(res, result.status, result.body);
      }
      if (req.method === 'GET' && url.pathname === '/api/history') return json(res, 200, runHistory(o.root, runs, o.stories()));
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'stories' && parts.length === 3) {
        const story = o.stories().find((s) => s.id === decodeURIComponent(parts[2]));
        return json(res, story ? 200 : 404, story ?? { error: 'Recording not found.' });
      }
      if (req.method === 'GET' && url.pathname === '/legacy') {
        const legacy = join(o.root, 'Faultline_Loop.html');
        if (!existsSync(legacy)) return json(res, 404, { error: 'Build legacy playback with npm run ui:loop.' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(readFileSync(legacy));
      }
      if (req.method === 'GET' && url.pathname === '/api/discovery') {
        if (!(await status()).mock.up) return json(res, 503, { error: 'Local target unavailable. Start with --sim or start your configured mock.' });
        return json(res, 200, { ...await discoverMock(), sim: o.sim, targetUrl: ctx.cfg.targetUrl, mapper: { available: !!process.env.GEMINI_API_KEY, model: MAPPING_MODEL } });
      }
      if (req.method === 'POST' && url.pathname === '/api/discovery/analyze') {
        const { approved } = await body(req);
        if (approved !== true) return json(res, 403, { error: 'Approve one Gemini mapping request before sending source code.' });
        if (!process.env.GEMINI_API_KEY) return json(res, 400, { error: 'Set GEMINI_API_KEY in Wisprno’s own environment and restart the server.' });
        if (mappingBusy) return json(res, 409, { error: 'A mapping request is already in progress.' });
        mappingBusy = true;
        try {
          if (!(await status()).mock.up) return json(res, 503, { error: 'Local target unavailable.' });
          const discovery = await discoverMock(), sources = mappingSources();
          const cache = join(archiveRoot, 'mapping', mappingKey(sources) + '.json');
          if (existsSync(cache)) return json(res, 200, { ...JSON.parse(readFileSync(cache, 'utf8')), cached: true });
          const analysis = await analyzeMapping(discovery, sources);
          writeJson(cache, analysis);
          return json(res, 200, { ...analysis, cached: false });
        } finally { mappingBusy = false; }
      }
      if (parts[0] === 'api' && parts[1] === 'runs' && validId(parts[2] ?? '') && req.method === 'GET') {
        const run = runs.get(parts[2]);
        if (run) return json(res, 200, { id: run.id, messages: run.messages, done: run.done, pending: run.pending, live: true });
        if (!existsSync(runPath(parts[2]))) return json(res, 404, { error: 'Run not found.' });
        const saved = JSON.parse(readFileSync(runPath(parts[2]), 'utf8'));
        return json(res, 200, { id: saved.id, messages: saved.messages, done: true, interrupted: !saved.done, pending: null, live: false });
      }
      if (req.method === 'GET' && url.pathname === '/api/tests') {
        const dir = join(archiveRoot, 'tests');
        return json(res, 200, existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))) : []);
      }
      if (req.method === 'POST' && url.pathname === '/api/tests') {
        const { runId } = await body(req);
        if (typeof runId !== 'string' || !validId(runId)) return json(res, 400, { error: 'Valid runId required.' });
        const run = runs.get(runId);
        const archived = existsSync(runPath(runId)) ? JSON.parse(readFileSync(runPath(runId), 'utf8')) : null;
        const regression = run?.regression ?? archived?.regression;
        if (!regression) return json(res, 409, { error: 'No minimized regression is available for this run yet.' });
        const test = { schema: 'faultline.regression.v1', id: runId, sourceRun: runId, createdAt: new Date().toISOString(), ...regression };
        if (!existsSync(testPath(runId))) writeJson(testPath(runId), test);
        return json(res, 200, JSON.parse(readFileSync(testPath(runId), 'utf8')));
      }
      if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'live' && parts[3] === 'decision') {
        const run = runs.get(parts[2]);
        if (!run || run.done) return json(res, 409, { error: 'Run is not waiting for approval.' });
        const { candidate, approved } = await body(req);
        if (typeof approved !== 'boolean' || typeof candidate !== 'string') return json(res, 400, { error: 'Candidate and boolean approved are required.' });
        try { run.decide(candidate, approved); } catch (e) { return json(res, 409, { error: (e as Error).message }); }
        persist(run);
        return json(res, 200, { candidate, approved });
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        if (!existsSync(o.page)) return json(res, 500, { error: `page not built: ${o.page} (npm run ui:build)` });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(readFileSync(o.page));
      }
      if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, await status());
      if (req.method === 'GET' && url.pathname === '/api/stories') return json(res, 200, o.stories());
      if (req.method === 'POST' && url.pathname === '/api/live') {
        const { mode, configuration: rawConfiguration, spendAuthorized } = await body(req);
        let configuration: RunConfiguration | undefined;
        if (rawConfiguration !== undefined) {
          try { configuration = parseConfiguration(rawConfiguration); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
          if (!o.sim && spendAuthorized !== true) return json(res, 403, { error: 'Confirm model API spend before starting a live run, or use --sim.' });
          await discoverMock();
        }
        if (mode !== 'loop' && mode !== 'sip') return json(res, 400, { error: "mode must be 'loop' or 'sip'" });
        if (busy && !busy.done) return json(res, 409, { error: 'a live run is already in progress', id: busy.id });
        if (mode === 'loop' && !(await status()).mock.up) return json(res, 503, { error: `mock target not reachable at ${ctx.cfg.targetUrl}` });
        const run = new LiveRun(mode);
        runs.set(run.id, run);
        run.subscribe(() => persist(run));
        busy = run;
        if (mode === 'loop') startLoop(run, configuration);
        else startSip(run);
        return json(res, 200, { id: run.id });
      }
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'live' && parts[3] === 'stream') {
        const run = runs.get(parts[2]);
        if (!run) return json(res, 404, { error: 'no such run' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        const write = (m: LiveMessage) => {
          res.write(`data: ${JSON.stringify(m)}\n\n`);
          if (m.kind === 'done' || m.kind === 'error') res.end();
        };
        const off = run.subscribe(write);
        const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
        req.on('close', () => {
          off();
          clearInterval(ping);
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/judge/start') {
        if (!(await status()).mock.up) return json(res, 503, { error: `mock target not reachable at ${ctx.cfg.targetUrl}` });
        const j = new JudgeSession(ctx);
        const events = await j.start();
        judges.set(j.id, j);
        const { mockHeader } = await import('./live.ts');
        return json(res, 200, { id: j.id, story: { ...mockHeader('lock_card', 'Judge mode', o.sim), title: 'Judge mode · original target', caller: { name: 'You', short: 'You', tactic: 'Judge', initials: 'YOU' } }, events });
      }
      if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'judge' && parts[3] === 'turn') {
        const j = judges.get(parts[2]);
        if (!j) return json(res, 404, { error: 'no such judge session' });
        const { text } = await body(req);
        if (typeof text !== 'string' || !text.trim() || text.length > 1000) return json(res, 400, { error: 'text required (≤1000 chars)' });
        return json(res, 200, { events: await j.say(text.trim()) });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      console.error(e);
      json(res, 500, { error: (e as Error).message });
    }
  });
  await new Promise<void>((r) => server.listen(o.port, '127.0.0.1', () => r()));
  return {
    url: `http://127.0.0.1:${o.port}/`,
    close: () => {
      server.close();
      stopSim?.();
    },
  };
}

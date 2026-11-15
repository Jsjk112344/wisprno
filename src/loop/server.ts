import {boundedMappingSources} from './mapping.ts';
import {managedStatus,prepareManaged,startManaged,managedJob,managedOwned,managedBinding,managedJobs} from '../managed/connections.ts';
import {managedClient} from '../managed/client.ts';
import {companionHub} from '../companion/hub.ts';
import {MAX_RELAY_BYTES} from '../companion/protocol.ts';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {runControl} from '../runner/control.ts';
import {ReviewQueue,REVIEW_POLICY,type ProjectQuota} from '../judge/review-queue.ts';
import {modelFromSpec} from '../providers/index.ts';
import {connectTarget,previewTarget} from '../adapter/connections.ts';
import {COMPATIBILITY} from '../adapter/bridge.ts';
import {InvestigationBudget,investigationScope} from '../spend/investigation.ts';
import {consumeRunAllowance,hasRunAllowance} from './run-allowance.ts';
import {spendStatus} from '../spend/client.ts';
import {repositoryList,repositories,selectRepository,repoAdapter,discoverRepository,repoSources,uploadSource} from '../adapter/repositories.ts';
import {repositoryReadiness} from './repository-readiness.ts';
import {runContractLoop} from './contract-live.ts';
import { readiness } from './readiness.ts';
import { InvestigationQueue } from '../tiger/investigations.ts';
import { timingSafeEqual, randomUUID } from 'node:crypto';
// Local server for the loop UI (127.0.0.1 only): serves the built page, its recorded stories, live runs as server-sent
// events, and judge sessions. `npm run faultline -- ui [--sim] [--port 4320]`.
//   --sim  runs the real mock server in-process with simulated models: $0, for rehearsing the live loop.
//   default uses TARGET_URL (our running voice_agent_mock) and the configured models; each live loop costs model calls.
// The SIP call path is the same gated command as `sip-call --mode live` (authorization + both budget ledgers).
import { runHistory } from './history.ts';
import { tigerMetrics } from '../tiger/http.ts';
import { mappingSources } from '../adapter/mapping-source.ts';
import { analyzeMapping, mappingKey, MAPPING_MODEL } from './mapping.ts';
import { parseConfiguration, type RunConfiguration } from './configuration.ts';
import { writeJson, sha256 } from '../runner/util.ts';
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

async function body(req: IncomingMessage,limit=300_000): Promise<any> {
  const chunks:Buffer[]=[];let bytes=0;
  for await(const chunk of req){const c=Buffer.from(chunk);bytes+=c.length;if(bytes>limit)throw Error('request too large');chunks.push(c);}
  const text=Buffer.concat(chunks).toString('utf8');return text?JSON.parse(text):{};
}

export async function startUiServer(o: UiServerOptions) {
  let ctx: Ctx;
  let stopSim: (() => void) | null = null;
  if (o.sim) {
    const dir = join(tmpdir(), `faultline-ui-sim-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const { startSimServer } = await import('../sim/server.ts');
    const sim = await startSimServer(dir, 1_000_000);
    ctx = makeCtx('live', { ...sim.cfg, concurrency: 4 });
    stopSim = () => sim.app.close();
  } else {
    ctx = makeCtx('live', {...loadConfig(),resultsDir:join(o.root,'results')});
  }
  const companions=companionHub(o.root);
  const runOwners=new Map<string,string>();
  const simulatedRuns=new Set<string>();
  const queue = new InvestigationQueue(o.root);
  const syncTimer = setInterval(() => { void queue.drain(); }, 30_000);
  syncTimer.unref();
  ctx.log = (m) => console.log(`[live] ${m}`);
  let mappingBusy = false;
  const runs = new Map<string, LiveRun>();
  const judges = new Map<string, JudgeSession>();
  let busy: LiveRun | null = null;

  const status = async (): Promise<ServerStatus> => {
    const up = await ctx.adapter.health().then(() => true, () => false);
    const s = sipStatus();
    return { activeRunId: busy && !busy.done ? busy.id : null, readiness: await readiness(ctx, o.sim), served: true, mock: { up, url: ctx.cfg.targetUrl }, sip: { workerUp: s.workerUp && !s.echoUp, callsLeft: s.callsLeft, reservedUsd: s.reservedUsd, approvedUsd: s.approvedUsd }, sim: o.sim };
  };

  const archiveRoot = join(o.root, 'results', 'ui');
  mkdirSync(archiveRoot,{recursive:true});
  const reviews=new ReviewQueue(join(archiveRoot,'disclosure-reviews.sqlite'));reviews.recoverInterrupted();
  const reviewConfig=join(archiveRoot,'judge-project.json');
  const reviewAvailability=()=>{const path=join(archiveRoot,'judge-validation.json');const v=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;const validated=v?.usable===true&&v.policy===REVIEW_POLICY&&v.model==='gemini:gemini-3.5-flash-lite';return {configured:validated&&existsSync(reviewConfig)&&!!process.env.GEMINI_API_KEY,model:'gemini:gemini-3.5-flash-lite',label:'Inferred review only; backend verdicts never change.',reason:v&&!validated?'Judge validation failed: '+v.agreement?.agree+' of '+v.agreement?.n+' agreements; 18 of 20 required. New reviews are disabled.':!validated?'Judge must pass the fixed labelled validation set before reviews are enabled.':'Validated on the labelled set; project configuration and key are still required.'};};
  const drainReviews=async()=>{if(!reviewAvailability().configured)return;if(process.env.PUBLIC_ORIGIN&&!hasRunAllowance(ctx.cfg.resultsDir))return;if(!existsSync(reviewConfig)||!process.env.GEMINI_API_KEY)return;const quota=JSON.parse(readFileSync(reviewConfig,'utf8')) as ProjectQuota;const model=modelFromSpec(quota.model);await reviews.drain(quota,model,Date.now(),async(input,request)=>{const budget=new InvestigationBudget(join(archiveRoot,'investigation-budget.sqlite'),input.runId);try{return await investigationScope.run(budget,()=>model.complete(request));}finally{budget.db.close();}});};
  const reviewTimer=setInterval(()=>{void drainReviews().catch(()=>{});},30000);reviewTimer.unref();
  const runPath = (id: string) => join(archiveRoot, 'runs', id + '.json');
  const testPath = (id: string) => join(archiveRoot, 'tests', id + '.json');
  const validId = (id: string) => /^[a-zA-Z0-9-]{1,80}$/.test(id);
  const archive = (run: LiveRun) => ({ id: run.id, ownerHash:runOwners.get(run.id), createdAt: run.createdAt, messages: run.messages, done: run.done, regression: run.regression, executionMode: o.sim || simulatedRuns.has(run.id) ? 'simulation' : 'real-model' });
  const persist = (run: LiveRun) => writeJson(runPath(run.id), archive(run));
  const savedDir = join(archiveRoot, 'runs');
  if (existsSync(savedDir)) for (const f of readdirSync(savedDir).filter(f => f.endsWith('.json'))) {
    const a = JSON.parse(readFileSync(join(savedDir, f), 'utf8'));
    if(a.ownerHash)runOwners.set(a.id,a.ownerHash);
    if (a.finalized) queue.enqueue(a, ctx.rawDir, a.executionMode === 'simulation');
  }
  void queue.drain();
  const startLoop = (run: LiveRun, configuration?: RunConfiguration, runCtx=ctx, contractDiscovery?:any,simulation=o.sim) => {
    let investigationBudget:InvestigationBudget|null=null;
    const generic=async()=>{if(contractDiscovery?.bridge&&!simulation){investigationBudget=new InvestigationBudget(join(archiveRoot,'investigation-budget.sqlite'),run.id);if(contractDiscovery.mappingBudgetId)investigationBudget.carry(contractDiscovery.mappingBudgetId);return investigationScope.run(investigationBudget,()=>runContractLoop(runCtx,run,contractDiscovery,configuration!,simulation));}return runContractLoop(runCtx,run,contractDiscovery,configuration!,simulation);};
    const operation = runControl.run(run.control,()=>contractDiscovery ? generic() : runLiveLoop(runCtx, run, { caseId: configuration?.caseId ?? 'lost_card', maxAttempts: process.env.PUBLIC_ORIGIN ? 1 : 4, replays: process.env.PUBLIC_ORIGIN ? 3 : 10, normalCalls: process.env.PUBLIC_ORIGIN ? 2 : 6, maxFixes: process.env.PUBLIC_ORIGIN ? 1 : 2, sim: o.sim, configuration, requireApproval: true }));
    operation.catch(async(e) => {await run.control.drain();run.send({ kind: 'error', message: (e as Error).message });})
      .finally(() => {
        if(investigationBudget)investigationBudget.db.close();
        runCtx.ledger.save();
        const saved = { ...archive(run), finalized: true };
        writeJson(runPath(run.id), saved);
        queue.enqueue(saved, runCtx.rawDir, simulation);
        void queue.drain();
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

  let postWindow = Date.now(), postCount = 0;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const parts = url.pathname.split('/').filter(Boolean);
      const publicOrigin = process.env.PUBLIC_ORIGIN;
      // The local worker has its own scoped bearer credential and cannot use browser APIs.
      if(req.method==='POST'&&url.pathname==='/api/companion/worker'){
        if(req.headers.origin||req.headers['sec-fetch-site'])return json(res,403,{error:'Companion worker requests must originate from the local command.'});
        try{const key=(req.headers.authorization??'').replace(/^Bearer /,''),id=String(req.headers['x-wisprno-companion']??''),op=String(req.headers['x-wisprno-operation']??'');
          if(!/^[a-f0-9-]{36}$/.test(id)||!['join','poll','result','disconnect','model'].includes(op))throw Error('Invalid worker envelope');
          if(op!=='join')companions.worker(id,key);
          const b=await body(req,op==='result'?MAX_RELAY_BYTES*6+50_000:op==='model'?35000:1000);if(b.id!==id||b.op!==op)throw Error('Mismatched worker envelope');
          if(b.op==='join')return json(res,200,companions.join(b.id,key));
          if(b.op==='poll')return json(res,200,await companions.poll(b.id,key));
          if(b.op==='model')return json(res,200,await companions.model(b.id,key,b));
          if(b.op==='result')return json(res,200,companions.result(b.id,key,b));
          if(b.op==='disconnect'){companions.disconnect(b.id,key);return json(res,200,{offline:true});}
          return json(res,400,{error:'Unknown companion operation'});
        }catch{return json(res,401,{error:'Companion request rejected. Check pairing, connection state and response bounds.'});}
      }
      const owner=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>/^wisprno_companion_owner=[a-f0-9]{64}$/.test(x))?.split('=')[1]??'';
      const canRun=(id:string)=>!runOwners.has(id)||!!owner&&runOwners.get(id)===sha256(owner);
      const selectOwned=(id:string|undefined)=>{const repo=selectRepository(id,o.root,ctx.cfg);if(repo.relayId)companions.browser(repo.relayId,owner);if(repo.managedJobId)managedBinding(o.root,repo.managedJobId,owner);return repo;};
      if(parts[0]==='api'&&['live','runs','ingestion'].includes(parts[1])&&parts[2]&&!canRun(parts[2]))return json(res,403,{error:'This laptop investigation belongs to its paired browser.'});

      const publicAccess=!!publicOrigin&&process.env.PUBLIC_NO_AUTH==='true';
      const preview=!!publicOrigin&&process.env.PUBLIC_PREVIEW==='true';
      const protectedPreviewRoute=req.method!=='GET'||url.pathname.endsWith('/evidence')||url.pathname==='/operator'||url.pathname==='/api/connections';
      if (publicOrigin&&!publicAccess&&(!preview||protectedPreviewRoute)) {
        const expected = Buffer.from('Basic ' + Buffer.from('wisprno:' + process.env.DEMO_PASSCODE).toString('base64'));
        const supplied = Buffer.from(req.headers.authorization ?? '');
        if (!process.env.DEMO_PASSCODE || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          if(preview&&url.pathname!=='/operator')return json(res,403,{error:'Public preview: this action requires operator authentication.'});
          res.setHeader('WWW-Authenticate', 'Basic realm="Wisprno", charset="UTF-8"');
          return json(res, 401, {error:'Authentication required.'});
        }
      }
      if(req.method==='GET'&&url.pathname==='/api/operator-status'){
        const expected=Buffer.from('Basic '+Buffer.from('wisprno:'+process.env.DEMO_PASSCODE).toString('base64')),supplied=Buffer.from(req.headers.authorization??'');
        return json(res,200,{authenticated:!publicOrigin||publicAccess||!!process.env.DEMO_PASSCODE&&supplied.length===expected.length&&timingSafeEqual(supplied,expected),required:!!publicOrigin&&!publicAccess});
      }
      const allowedOrigin = publicOrigin ?? `http://${req.headers.host}`;
      if ((req.headers.origin && req.headers.origin !== allowedOrigin) || (publicOrigin && req.method === 'POST' && req.headers.origin !== allowedOrigin)) return json(res, 403, { error: 'Same-origin request required.' });
      if (req.method === 'POST') {
        if (Date.now() - postWindow > 60_000) {postWindow = Date.now(); postCount = 0;}
        if (++postCount > 60) return json(res, 429, {error:'Too many requests. Retry later.'});
      }
      if(req.method==='GET'&&url.pathname==='/api/managed/status')return json(res,200,await managedStatus(o.root));
      if(req.method==='GET'&&url.pathname==='/api/managed/jobs')return json(res,200,{items:await managedJobs(o.root,owner,url.searchParams.get('sourceId')??'')});
      if(req.method==='POST'&&url.pathname==='/api/managed/plan'){
        const browser=owner||randomBytes(32).toString('hex');res.setHeader('Set-Cookie','wisprno_companion_owner='+browser+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000'+(publicOrigin?.startsWith('https:')?'; Secure':''));
        try{return json(res,200,await prepareManaged(o.root,await body(req),browser));}catch(e){return json(res,400,{error:(e as Error).message});}
      }
      if(req.method==='POST'&&url.pathname==='/api/managed/start'){try{return json(res,202,await startManaged(o.root,await body(req),owner));}catch(e){return json(res,400,{error:(e as Error).message});}}
      if(parts[0]==='api'&&parts[1]==='managed'&&parts[2]==='jobs'&&parts[3]){
        try{if(req.method==='GET')return json(res,200,await managedJob(o.root,parts[3],owner));
          if(req.method==='POST'&&parts[4]==='stop'){managedBinding(o.root,parts[3],owner);if(busy&&!busy.done)return json(res,409,{error:'Stop or finish the active investigation before stopping its sandbox.'});return json(res,200,await managedClient(o.root).call('/jobs/'+parts[3]+'/stop',{}));}
        }catch(e){return json(res,400,{error:(e as Error).message});}
      }
      if(req.method==='GET'&&url.pathname==='/companion.mjs'){
        res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Content-Disposition':'attachment; filename="wisprno-companion.mjs"','Cache-Control':'no-store'});
        return res.end(readFileSync(fileURLToPath(new URL('../../scripts/companion.mjs',import.meta.url))));
      }
      if(req.method==='POST'&&url.pathname==='/api/companions'){
        const browser=owner||randomBytes(32).toString('hex');
        res.setHeader('Set-Cookie','wisprno_companion_owner='+browser+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000'+(publicOrigin?.startsWith('https:')?'; Secure':''));
        return json(res,200,companions.create(browser));
      }
      if(parts[0]==='api'&&parts[1]==='companions'&&parts[2]){
        try{if(req.method==='POST'&&parts[3]==='revoke'){companions.revoke(parts[2],owner);return json(res,200,{revoked:true});}
          if(req.method==='GET')return json(res,200,companions.status(parts[2],owner));
        }catch{return json(res,403,{error:'Pairing unavailable in this browser. Create a new pairing.'});}
      }
      if (publicOrigin && req.method === 'POST' && url.pathname.startsWith('/api/judge')) return json(res,403,{error:'Judge calls are disabled on this deployment.'});
      if (req.method === 'POST' && parts[1] === 'ingestion' && validId(parts[2] ?? '')) {
        queue.retry(parts[2]); void queue.drain(); return json(res,200,{state:'pending'});
      }

      if(req.method==='GET'&&parts[0]==='brand'&&parts.length===2&&['WisprNo-horizontal-dark.svg','WisprNo-icon-mono-dark.svg','WisprNo-icon-mono-light.svg','wisprno.css'].includes(parts[1])){res.writeHead(200,{'Content-Type':parts[1].endsWith('.svg')?'image/svg+xml':'text/css','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});return res.end(readFileSync(join(o.root,'ui/brand',parts[1])));}
      if (req.method === 'GET' && url.pathname === '/tiger') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(readFileSync(join(o.root, 'ui/tiger/index.html')));
      }
      if (req.method === 'GET' && url.pathname === '/api/metrics') {
        const result = await tigerMetrics(); return json(res, result.status, result.body);
      }
      if (req.method === 'GET' && url.pathname === '/api/history') { const h = runHistory(o.root, runs, o.stories()); return json(res, 200, {...h, items:h.items.filter(item=>canRun(item.id)).map(item => ({...item, ingestion:queue.state(item.id)}))}); }
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'stories' && parts.length === 3) {
        const story = o.stories().find((s) => s.id === decodeURIComponent(parts[2]));
        return json(res, story ? 200 : 404, story ?? { error: 'Recording not found.' });
      }
      if (req.method === 'GET' && url.pathname === '/legacy') {
        const legacy = join(o.root, 'Faultline_Loop.html');
        if (!existsSync(legacy)) return json(res, 404, { error: 'Build legacy playback with npm run ui:loop.' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(readFileSync(legacy));
      }
      if(req.method==='GET'&&url.pathname==='/api/reviews/status')return json(res,200,reviewAvailability());
      if(req.method==='GET'&&url.pathname==='/api/reviews')return json(res,200,{items:reviews.list(url.searchParams.get('runId')??'').filter(j=>j&&canRun(j.runId))});
      if(req.method==='POST'&&url.pathname==='/api/reviews'){
        const b=await body(req);if(b.runId&&!canRun(b.runId))return json(res,403,{error:'This investigation belongs to its paired browser.'});if(b.approved!==true)return json(res,403,{error:'Explicit model-spend approval required for this review.'});
        if(!reviewAvailability().configured)return json(res,409,{error:reviewAvailability().reason});
        if(!validId(b.runId??'')||typeof b.question!=='string')return json(res,400,{error:'A saved run and evaluator question are required.'});
        const path=join(queue.dir,b.runId+'.bundle.json');if(!existsSync(path))return json(res,409,{error:'Finish and archive the investigation before review.'});
        const bundle=JSON.parse(readFileSync(path,'utf8')),header=bundle.messages.find((m:any)=>m.kind==='story')?.story;
        const report=bundle.messages.find((m:any)=>m.kind==='event'&&m.event.type==='note'&&m.event.text.startsWith('Investigation report: '));
        if(!header?.sources?.length||!report)return json(res,409,{error:'Review requires a source-bound generic investigation report.'});
        const evidence:any=Object.entries(bundle.files).find(([key])=>key.startsWith('attack/evidence/'))?.[1];if(!evidence?.transcript)return json(res,409,{error:'No original attack transcript is available.'});
        const quota=JSON.parse(readFileSync(reviewConfig,'utf8'));const policyHash=JSON.parse(report.event.text.slice('Investigation report: '.length)).policyHash;
        const job=reviews.enqueue({runId:b.runId,model:quota.model,sourceHash:sha256(JSON.stringify(header.sources)),policyHash,question:b.question,authorization:evidence.events.filter((e:any)=>e.type==='turn.completed').map((e:any)=>({turn:e.turn,auth:e.auth})),transcript:evidence.transcript.filter((m:any)=>['user','assistant'].includes(m.role)&&typeof m.content==='string').map((m:any)=>({role:m.role,content:m.content}))});void drainReviews().catch(()=>{});return json(res,200,job);
      }
      if(req.method==='POST'&&url.pathname==='/api/reviews/resume'){const b=await body(req);if(b.runId&&!canRun(b.runId))return json(res,403,{error:'This investigation belongs to its paired browser.'});if(b.approved!==true)return json(res,403,{error:'Confirm resumed model spend and project quota.'});const review=reviews.get(String(b.key));if(review&&!canRun(review.runId))return json(res,403,{error:'This review belongs to its paired browser.'});reviews.resume(String(b.key));void drainReviews().catch(()=>{});return json(res,200,{state:'pending'});}
      if(req.method==='GET'&&url.pathname==='/operator'){res.writeHead(303,{Location:'/new'});return res.end();}
      if(req.method==='GET'&&url.pathname==='/api/compatibility')return json(res,200,COMPATIBILITY);
      if(req.method==='POST'&&['/api/connections/preview','/api/connections'].includes(url.pathname)){try{return json(res,200,await (url.pathname.endsWith('/preview')?previewTarget:connectTarget)(o.root,await body(req),owner));}catch(e){return json(res,400,{error:(e as Error).message});}}
      if (req.method === 'GET' && url.pathname === '/api/repositories') return json(res,200,{items:repositoryList(o.root,ctx.cfg).filter(r=>(!r.relayId||companions.owns(r.relayId,owner))&&(!r.managedJobId||managedOwned(o.root,r.managedJobId,owner)))});
      if (req.method === 'POST' && url.pathname === '/api/repositories') {
        try{return json(res,200,uploadSource(o.root,await body(req),repositories(ctx.cfg)));}catch(e){return json(res,400,{error:(e as Error).message});}
      }
      if (req.method === 'GET' && url.pathname === '/api/discovery') {
        try {
          const repo=selectOwned(url.searchParams.get('repository')??undefined);
          const rc=repo.id==='pioneer'?ctx:makeCtx('live',{...ctx.cfg,targetUrl:repo.url},repoAdapter(repo,ctx.cfg));
          const discovery=await discoverRepository(repo,ctx.cfg), ready=await repositoryReadiness(repo,rc,o.sim);
          return json(res,200,{...discovery,adapter:repo.adapter,repositoryId:url.searchParams.get('repository')??repo.id,sim:ready.mode==='simulation',targetUrl:repo.managedJobId?'Managed sandbox':repo.relayId?'Local companion (outbound)':rc.cfg.targetUrl,readiness:ready,sourceFiles:repoSources(repo).map(({file,sha256})=>({file,sha256})),mapper:{available:!!process.env.GEMINI_API_KEY,model:MAPPING_MODEL}});
        }catch(e){return json(res,503,{error:(e as Error).message});}
      }
      if (req.method === 'POST' && url.pathname === '/api/discovery/analyze') {
        const { approved, repositoryId } = await body(req);
        if(process.env.PUBLIC_ORIGIN&&!hasRunAllowance(ctx.cfg.resultsDir))return json(res,403,{error:'Master spend switch or run allowance is disabled.'});
        if (approved !== true) return json(res, 403, { error: 'Approve one Gemini mapping request before sending source code.' });
        if (!process.env.GEMINI_API_KEY) return json(res, 400, { error: 'Set GEMINI_API_KEY in Wisprno’s own environment and restart the server.' });
        if (mappingBusy) return json(res, 409, { error: 'A mapping request is already in progress.' });
        mappingBusy = true;
        try {
          const repo=selectOwned(repositoryId);
          const discovery=await discoverRepository(repo,ctx.cfg), sources=boundedMappingSources(repo.adapter==='mock'?mappingSources():repoSources({...repo,files:repo.mappingFiles??repo.files}),discovery.tools.filter((t:any)=>t.testCase).map((t:any)=>t.name));
          
          const cache = join(archiveRoot, 'mapping', mappingKey(sources) + '.json');
          if (existsSync(cache)) return json(res, 200, { ...JSON.parse(readFileSync(cache, 'utf8')), cached: true });
          const attempt=cache+'.attempt.json';
          if(existsSync(attempt)) return json(res,409,{error:'A request was already attempted for this source version. No automatic retry is permitted.'});
          writeJson(attempt,{startedAt:new Date().toISOString()});
          const mappingBudget=repo.bridge?new InvestigationBudget(join(archiveRoot,'investigation-budget.sqlite'),'mapping-'+mappingKey(sources)):null;
          let analysis;try{analysis=mappingBudget?await investigationScope.run(mappingBudget,()=>analyzeMapping(discovery,sources)):await analyzeMapping(discovery,sources);}finally{mappingBudget?.db.close();}
          writeJson(cache, analysis);
          return json(res, 200, { ...analysis, cached: false });
        } finally { mappingBusy = false; }
      }
      if (req.method === 'GET' && parts[1] === 'runs' && validId(parts[2] ?? '') && parts[3] === 'evidence') {
        const path = join(queue.dir, parts[2] + '.bundle.json');
        return existsSync(path) ? json(res,200,JSON.parse(readFileSync(path,'utf8'))) : json(res,404,{error:'Evidence bundle available after the investigation finishes.'});
      }
      if (parts[0] === 'api' && parts[1] === 'runs' && validId(parts[2] ?? '') && req.method === 'GET') {
        const run = runs.get(parts[2]);
        if (run) return json(res, 200, { ...archive(run), pending: run.pending, live: true });
        if (!existsSync(runPath(parts[2]))) return json(res, 404, { error: 'Run not found.' });
        const saved = JSON.parse(readFileSync(runPath(parts[2]), 'utf8'));
        return json(res, 200, { ...saved, done: true, interrupted: !saved.done, pending: null, live: false });
      }
      if (req.method === 'GET' && url.pathname === '/api/tests') {
        const dir = join(archiveRoot, 'tests');
        return json(res, 200, existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).filter(t=>canRun(t.sourceRun)) : []);
      }
      if (req.method === 'POST' && url.pathname === '/api/tests') {
        const { runId } = await body(req);
        if(!canRun(runId))return json(res,403,{error:'This investigation belongs to its paired browser.'});
        if (typeof runId !== 'string' || !validId(runId)) return json(res, 400, { error: 'Valid runId required.' });
        const run = runs.get(runId);
        const archived = existsSync(runPath(runId)) ? JSON.parse(readFileSync(runPath(runId), 'utf8')) : null;
        const regression = run?.regression ?? archived?.regression;
        if (!regression) return json(res, 409, { error: 'No minimized regression is available for this run yet.' });
        const test = { schema: 'faultline.regression.v1', id: runId, sourceRun: runId, createdAt: new Date().toISOString(), ...regression };
        if (!existsSync(testPath(runId))) writeJson(testPath(runId), test);
        return json(res, 200, JSON.parse(readFileSync(testPath(runId), 'utf8')));
      }
      if(req.method==='POST'&&parts[0]==='api'&&parts[1]==='live'&&parts[3]==='stop'){
        const run=runs.get(parts[2]);if(!run)return json(res,404,{error:'Active run not found.'});
        if(run.mode!=='loop')return json(res,409,{error:'This control stops text investigations only.'});
        run.stop();persist(run);return json(res,200,{id:run.id,state:run.done?'finished':'stopping'});
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
      if (req.method === 'GET' && (['/', '/index.html', '/new', '/analyses', '/demo', '/demo/new', '/demo/analyses', '/demo/investigation'].includes(url.pathname) || /^\/analysis\/(run|story)\/[^/]+$/.test(url.pathname))) {
        if (!existsSync(o.page)) return json(res, 500, { error: `page not built: ${o.page} (npm run ui:build)` });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(readFileSync(o.page));
      }
      if (req.method === 'GET' && url.pathname === '/api/spend') return json(res,200,await spendStatus());
      if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, await status());
      if(req.method==='GET'&&url.pathname==='/api/demo'){
        const story=o.stories().find(s=>s.id==='checks-round-02'&&s.kind==='recorded'&&s.tier==='backend-record');
        if(!story)return json(res,404,{error:'The banking analysis is unavailable.'});
        const {voiced:_voiced,...recorded}=story;
        return json(res,200,recorded);
      }
      if (req.method === 'GET' && url.pathname === '/api/stories') return json(res, 200, o.stories());
      if (req.method === 'POST' && url.pathname === '/api/live') {
        const { mode, configuration: rawConfiguration, spendAuthorized, launchId } = await body(req);
        if(launchId!==undefined&&(typeof launchId!=='string'||! /^[a-f0-9-]{36}$/.test(launchId)))return json(res,400,{error:'Invalid launch idempotency key.'});
        const launchPath=launchId?join(archiveRoot,'launches',launchId+'.json'):null;
        const launchHash=sha256(JSON.stringify({mode,configuration:rawConfiguration,spendAuthorized,owner:owner?sha256(owner):undefined}));
        if(launchPath&&existsSync(launchPath)){const saved=JSON.parse(readFileSync(launchPath,'utf8'));if(saved.hash!==launchHash)return json(res,409,{error:'This launch key belongs to a different request.'});return json(res,200,{id:saved.id,reused:true});}
        let configuration: RunConfiguration | undefined;
        if (rawConfiguration !== undefined) {
          try { configuration = parseConfiguration(rawConfiguration); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
          

        }
        
        if (process.env.PUBLIC_ORIGIN && mode === 'sip') return json(res,403,{error:'SIP is disabled on this deployment.'});
        const repo=selectOwned(configuration?.repositoryId);
        const simulation=o.sim||!!repo.bridge&&repo.version?.model?.provider==='stub';
        if(!simulation&&spendAuthorized!==true)return json(res,403,{error:'Confirm model API spend before starting a live run.'});
        const runCtx=repo.id==='pioneer'?ctx:makeCtx('live',{...ctx.cfg,targetUrl:repo.url},repoAdapter(repo,ctx.cfg));
        let contractDiscovery:any;
        if (mode === 'loop') {const r=await repositoryReadiness(repo,runCtx,o.sim);if(!r.ready)return json(res,503,{error:r.reasons.join(' '),readiness:r});if(repo.adapter==='contract'){if(!configuration)return json(res,400,{error:'Target action required'});contractDiscovery=await discoverRepository(repo,ctx.cfg);contractDiscovery.mappingBudgetId='mapping-'+mappingKey(boundedMappingSources(repoSources({...repo,files:repo.mappingFiles??repo.files}),contractDiscovery.tools.filter((t:any)=>t.testCase).map((t:any)=>t.name)));if(repo.bridge)contractDiscovery.bridge=repo.bridge;if(!contractDiscovery.tools.some((t:any)=>t.testCase===configuration.caseId))return json(res,400,{error:'Select an action from this target’s current tool catalogue.'});}else if(configuration?.caseId.startsWith('contract:'))return json(res,400,{error:'Target does not expose this contract action'});}
        if (mode !== 'loop' && mode !== 'sip') return json(res, 400, { error: "mode must be 'loop' or 'sip'" });
        if(launchPath&&existsSync(launchPath)){const saved=JSON.parse(readFileSync(launchPath,'utf8'));return json(res,saved.hash===launchHash?200:409,saved.hash===launchHash?{id:saved.id,reused:true}:{error:'Launch key conflict.'});}
        if (busy && !busy.done) return json(res, 409, { error: 'a live run is already in progress', id: busy.id });

        if(existsSync(join(o.root,'results','deploying')))return json(res,503,{error:'Deployment in progress. No run started; try again after the update.'});
        if (!simulation && process.env.PUBLIC_ORIGIN) consumeRunAllowance(ctx.cfg.resultsDir);
        const run = new LiveRun(mode);
        if(simulation)simulatedRuns.add(run.id);
        if(launchPath)writeJson(launchPath,{id:run.id,hash:launchHash,createdAt:run.createdAt});
        if(repo.relayId||repo.managedJobId)runOwners.set(run.id,sha256(owner));
        runs.set(run.id, run);
        persist(run);
        run.subscribe(() => persist(run));
        busy = run;
        if (mode === 'loop') startLoop(run, configuration, runCtx, contractDiscovery,simulation);
        else startSip(run);
        return json(res, 200, { id: run.id });
      }
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'live' && parts[3] === 'stream') {
        const run = runs.get(parts[2]);
        if (!run) return json(res, 404, { error: 'no such run' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
        res.flushHeaders();
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
    url: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/`,
    close: () => {
      companions.close();
      clearInterval(syncTimer);
      clearInterval(reviewTimer);
      server.close();
      stopSim?.();
    },
  };
}

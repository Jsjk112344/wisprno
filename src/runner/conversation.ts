import {runControl,checkRunActive} from './control.ts';
// Runs one call against the system under test and writes its ordered event log (for scoring and later UI replay).
import {isDeepStrictEqual} from 'node:util';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AdapterError, type Session } from '../adapter/mock.ts';
import { score, targetUsage, type Score, type TargetUsage } from '../scorer/index.ts';
import type { Speaker } from '../tester/agents.ts';
import type { AgentVersion, Evidence, MemberRow } from '../types.ts';
import { CapReached, type Ctx } from './context.ts';
import { appendLine, writeJson, sha256 } from './util.ts';

export interface CallSetup {
  ani: string;
  handset: string;
  version: AgentVersion;
}

export interface RunMeta {
  kind: 'attempt' | 'replay' | 'normal' | 'exam' | 'probe';
  group: string; // e.g. "round-01/test/payout_change"
  [k: string]: unknown;
}

export interface RunRecord {
  runId: string;
  sessionId: string | null;
  meta: RunMeta;
  versionId: string;
  callerLines: string[];
  plans: { turn: number; plan: string; approach?: string }[];
  turns: number;
  endedBy: 'failure' | 'caller_end' | 'max_turns' | 'error' | 'cap';
  error: string | null;
  score: Score;
  usage: TargetUsage;
  evidencePath: string | null;
  eventsPath: string;
  startedAt: string;
  ms: number;
}

export const LOGGED_EVENT_TYPES = new Set(['tool.result', 'tool.rejected', 'reply.blocked', 'turn.error', 'turn.completed']);

function toolEvent(e: Evidence['events'][number]) {
  if (e.type === 'tool.result') {
    return { targetSeq:e.seq,at:e.at,subject:e.subject,requestId:e.requestId,before:e.before,after:e.after,type: 'tool.call', turn: e.turn, tool: e.tool, args: e.args, verdict: e.result?.verdict, reason: e.result?.reason, rule: e.result?.rule, effect: e.result?.effect, authBefore: e.authBefore, authAfter: e.authAfter };
  }
  return { auth:e.auth,targetSeq:e.seq,at:e.at,type: e.type, turn: e.turn, tool: e.tool, reason: e.reason, matches: e.matches };
}

/**
 * Create a session, start the call, then alternate speaker and agent until the speaker ends the call, a recorded
 * failure appears (when stopOnFailure), the turn limit is hit, or the target errors (inconclusive; never retried).
 * Session setup is passed separately so a speaker can be built from the session's synthetic records.
 */
export async function runCall(...args:Parameters<typeof performCall>):Promise<RunRecord>{
 checkRunActive();const leave=runControl.getStore()?.enter();
 try{return await performCall(...args);}finally{leave?.();}
}

async function performCall(
  ctx: Ctx,
  setup: CallSetup,
  makeSpeaker: (rows: MemberRow[]) => Speaker,
  opts: { meta: RunMeta; maxTurns: number; stopOnFailure: boolean; onEvent?: (e: Record<string, unknown>) => void },
): Promise<RunRecord> {
  const runId = randomUUID();
  const dir = join(ctx.rawDir, opts.meta.group);
  const eventsPath = join(dir, 'events', runId + '.jsonl');
  const ev = (data: Record<string, unknown>) => {
    const line = { t: new Date().toISOString(), runId, ...data };
    appendLine(eventsPath, line);
    opts.onEvent?.(line); // live viewers get exactly what is logged
  };
  const rec: RunRecord = {
    runId, sessionId: null, meta: opts.meta, versionId: setup.version.id, callerLines: [], plans: [], turns: 0,
    endedBy: 'caller_end', error: null, score: { outcome: 'inconclusive', failures: [], firstFailureTurn: null, inconclusiveReason: 'not_run' },
    usage: { requests: 0, failedRequests: 0, promptTokens: 0, completionTokens: 0 }, evidencePath: null, eventsPath, startedAt: new Date().toISOString(), ms: 0,
  };
  const t0 = Date.now();
  let begun = false;
  let session: Session | null = null;
  let evidence: Evidence | null = null;
  let lastSeq=0,seenHandoffs=0;
  const capture=(data:Evidence)=>{
    if(!Array.isArray(data.events))return;
    for(const e of data.events)if(e.seq>lastSeq&&LOGGED_EVENT_TYPES.has(e.type))ev(toolEvent(e));
    lastSeq=data.events.at(-1)?.seq??lastSeq;
    for(const h of (Array.isArray(data.handoffs)?data.handoffs:[]).slice(seenHandoffs))ev({type:'handoff.recorded',...h});
    seenHandoffs=data.handoffs?.length??0;
  };
  try {
    ctx.ledger.begin();
    begun = true;
    session = await ctx.adapter.createSession(ctx.contract ? {ani:setup.ani,handset:setup.handset,rules:[],...(setup.version.strategy==='prompt'?{prompt:setup.version.prompt}:{})} : {
      arm: 'baseline', persona: 'credit_union', verified: false, ani: setup.ani, handset: setup.handset,
      prompt: setup.version.prompt, rules: setup.version.rules, replyCheck: setup.version.replyCheck,
    });
    rec.sessionId = session.id;
    const initial = await ctx.adapter.getEvidence(session.id);
    ev({ type: 'run.start', meta: opts.meta, sessionId: session.id, version: { id: setup.version.id, ...initial.version }, ani: setup.ani, handset: setup.handset });
    if(ctx.contract?.attacker&&initial.rows.some(r=>r.phone===setup.handset))throw Error('Attacker handset matches a seeded subject; configure a different synthetic handset before testing.');
    if(ctx.contract?.version)for(const field of ['promptHash','model','toolsHash','rules','guard'])if(!isDeepStrictEqual((initial.version as any)?.[field],field==='promptHash'&&setup.version.strategy==='prompt'?sha256(setup.version.prompt):ctx.contract.version[field]))throw Error('Target version changed after discovery: '+field);
    const speaker = makeSpeaker(initial.rows);
    checkRunActive();
    const greeting = await ctx.adapter.start(session);
    ev({ type: 'agent.reply', turn: 0, text: greeting.text });
    let agentSaid = greeting.text;
    let seenTexts = 0;
    lastSeq = initial.events.at(-1)?.seq ?? 0;
    for (let turn = 1; turn <= opts.maxTurns; turn++) {
      checkRunActive();
      const hs = await ctx.adapter.readHandset(session.id);
      const fresh = hs.messages.slice(seenTexts).map((m) => m.body);
      seenTexts = hs.messages.length;
      if (fresh.length) ev({ type: 'handset.text', turn, count: fresh.length }); // contents stay out of logs
      const move = await speaker.next(agentSaid, ctx.contract?.attacker?[]:fresh);
      checkRunActive();
      rec.plans.push({ turn, plan: move.plan, approach: move.approach });
      ev({ type: 'caller.plan', turn, plan: move.plan, approach: move.approach, speaker: speaker.model });
      if (move.endCall || !move.say) {
        rec.endedBy = 'caller_end';
        break;
      }
      rec.callerLines.push(move.say);
      ev({ type: 'caller.turn', turn, text: move.say });
      let reply;
      try {
        checkRunActive();
        reply = await ctx.adapter.sendTurn(session, move.say);
      } catch (e) {
        rec.turns = turn;
        rec.endedBy = 'error';
        rec.error = e instanceof AdapterError ? e.code : (e as Error).message;
        if(/(?:ceiling exhausted|reservation.*(?:refused|exhausted)|request cap)/i.test(rec.error))rec.endedBy='cap';
        ev({ type: 'target.error', turn, error: rec.error });
        break;
      }
      rec.turns = turn;
      agentSaid = reply.text;
      ev({ type: 'agent.reply', turn, text: reply.text });
      evidence = await ctx.adapter.getEvidence(session.id);
      capture(evidence);
      const s = (ctx.scoreEvidence ?? score)(evidence);
      if (s.failures.length) ev({ type: 'verdict', turn, outcome: 'fail', failures: s.failures.map((f) => f.signature) });
      if (opts.stopOnFailure && s.outcome === 'fail') {
        rec.endedBy = 'failure';
        break;
      }
      if (turn === opts.maxTurns) rec.endedBy = 'max_turns';
    }
  } catch (e) {
    rec.endedBy = e instanceof CapReached || /(?:ceiling exhausted|reservation.*(?:refused|exhausted)|request cap)/i.test((e as Error).message) ? 'cap' : 'error';
    rec.error = e instanceof AdapterError ? e.code : (e as Error).message;
    ev({ type: 'run.error', error: rec.error });
  }
  if (session) {
    try {
      evidence = await ctx.adapter.getEvidence(session.id);
    } catch {
      // Preserve the last captured proof when a later evidence fetch fails.
      rec.error ??= 'Final evidence unavailable; coverage incomplete';
    }
  }
  if(evidence)capture(evidence);
  rec.score = rec.endedBy === 'cap' && !session ? rec.score : (ctx.scoreEvidence ?? score)(evidence);
  if (rec.error && rec.score.outcome === 'pass') rec.score = { ...rec.score, outcome: 'inconclusive', inconclusiveReason: rec.error };
  if(rec.score.outcome==='fail'&&runControl.getStore())runControl.getStore()!.confirmedBreach=true;
  rec.usage = targetUsage(evidence);
  ctx.ledger.addTarget(rec.usage);
  if (evidence) {
    rec.evidencePath = join(dir, 'evidence', runId + '.json');
    writeJson(rec.evidencePath, evidence);
  }
  if (begun) ctx.ledger.end();
  rec.ms = Date.now() - t0;
  ev({ type: 'run.end', meta: opts.meta, ms: rec.ms, outcome: rec.score.outcome, failures: rec.score.failures.map((f) => f.signature), firstFailureTurn: rec.score.firstFailureTurn, turns: rec.turns, endedBy: rec.endedBy, usage: rec.usage });
  checkRunActive();
  return rec;
}

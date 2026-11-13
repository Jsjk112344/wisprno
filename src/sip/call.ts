// One adaptive tester call over SIP (demo layer). The tester only hears what comes down the line: its input is the
// transcription of the agent's decoded audio, never the target's internal log. Its lines are synthesized and sent as
// call audio; keypad presses go as DTMF. The caller's log uses the experiment's event envelope; the target's own log
// is merged in afterwards for tool calls, caller ID, received DTMF and artifacts.
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Speaker } from '../tester/agents.ts';
import { appendLine } from '../runner/util.ts';
import type { Phone } from './baresip.ts';
import { findSegment, nextChunkEnd, type ListenOptions } from './listen.ts';
import type { Voice } from './voice.ts';
import { seconds, withSilence, wavBytes } from './wav.ts';

export interface SipCallOptions {
  dialUri: string;
  meta: { kind: string; group: string; [k: string]: unknown };
  maxTurns: number;
  maxCallMs: number;
  /** How long to wait for the agent to start speaking after the caller's line (or after answering). */
  replyStartMs?: number;
  /** Longest single agent reply before it is cut and transcribed as is. */
  maxReplyMs?: number;
  listen?: Partial<ListenOptions>;
  /** Extra fields for run.start (scenario, models, authorization). */
  start?: Record<string, unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SipCallRecord {
  runId: string;
  callId: string | null;
  turns: number;
  endedBy: 'caller_end' | 'agent_hangup' | 'max_turns' | 'max_duration' | 'error';
  error: string | null;
  callerLines: string[];
  heard: string[];
  ms: number;
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export async function runSipCall(dir: string, phone: Phone, tester: Speaker, voice: Voice, o: SipCallOptions): Promise<SipCallRecord & { eventsPath: string }> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const runId = 'faultline-sip-' + randomUUID();
  const eventsPath = join(dir, 'caller-events.jsonl');
  const ev = (data: Record<string, unknown>) => appendLine(eventsPath, { t: new Date(now()).toISOString(), runId, ...data });
  const listenOpts: ListenOptions = { rate: phone.rate, ...o.listen };
  const rec: SipCallRecord = { runId, callId: null, turns: 0, endedBy: 'caller_end', error: null, callerLines: [], heard: [], ms: 0 };
  const t0 = now();

  /** Wait for the agent to speak from sample `from`, then for its turn to end; transcribe what was heard. */
  let establishedAt = 0;
  const listen = async (turn: number, from: number, part = 1, startMs = o.replyStartMs ?? 20_000): Promise<{ text: string; end: number } | null> => {
    const started = now();
    // Pieces of the reply already sent for transcription while the agent kept talking.
    const pieces: Promise<string>[] = [];
    let cursor = -1;
    for (;;) {
      const heard = phone.heard();
      const seg = findSegment(heard, from, listenOpts);
      const closed = phone.closed || phone.callClosed;
      const tooLong = seg && !seg.complete && (heard.length - seg.start) / phone.rate * 1000 > (o.maxReplyMs ?? 60_000);
      if (seg && (seg.complete || tooLong || closed)) {
        const detectedAt = now();
        const lastFrom = cursor < 0 ? seg.start : cursor;
        if (seg.end > lastFrom) pieces.push(voice.transcribe({ rate: phone.rate, samples: heard.slice(lastFrom, seg.end) }));
        const text = (await Promise.all(pieces)).map((x) => x.trim()).filter(Boolean).join(' ');
        const at = (x: number) => Math.round(x / phone.rate * 1000);
        // Latency telemetry: how far the recording lags the wall clock, when the end of the turn was detected, and
        // how long the remaining transcription took after that.
        const timing = { listenMs: detectedAt - started, sttMs: now() - detectedAt, pieces: pieces.length, dumpLagMs: establishedAt ? Math.round(detectedAt - establishedAt - at(heard.length)) : null, silenceTailMs: at(heard.length - seg.end) };
        ev({ type: 'agent.reply', turn, text, heard: 'caller_stt', stt: voice.stt, part, audioMs: [at(seg.start), at(seg.end)], seconds: Number(((seg.end - seg.start) / phone.rate).toFixed(2)), cut: tooLong ? 'max_reply' : closed && !seg.complete ? 'call_closed' : undefined, timing });
        rec.heard.push(text);
        return { text, end: seg.end };
      }
      if (seg) {
        // The agent is mid-reply: transcribe each finished stretch now instead of after it stops.
        if (cursor < 0) cursor = seg.start;
        for (let end = nextChunkEnd(heard, cursor, listenOpts); end !== null; end = nextChunkEnd(heard, cursor, listenOpts)) {
          const piece = voice.transcribe({ rate: phone.rate, samples: heard.slice(cursor, end) });
          piece.catch(() => undefined); // awaited (and its error raised) with the others when the turn ends
          pieces.push(piece);
          cursor = end;
        }
      }
      if (closed || (!seg && now() - started > startMs)) return null;
      await sleep(100);
    }
  };
  const closed = () => phone.closed || phone.callClosed;

  ev({ type: 'run.start', meta: o.meta, sessionId: runId, transport: 'sip', layer: 'demo', synthetic: true,
    presentedFrom: phone.from, callerId: phone.from.user, callerIdVerified: false, destination: o.dialUri,
    speaker: tester.model, tts: voice.tts, stt: voice.stt, ...o.start });
  try {
    ev({ type: 'caller.dial', uri: o.dialUri, from: phone.from.uri, displayName: phone.from.displayName });
    const { callId } = await phone.dial(o.dialUri);
    rec.callId = callId;
    establishedAt = now();
    ev({ type: 'call.established', callId });
    let lastEnd = 0;
    const greeting = await listen(0, 0);
    if (greeting) lastEnd = greeting.end;
    let agentSaid = greeting?.text ?? '';
    if (!greeting) ev({ type: 'agent.silent', turn: 0 });
    for (let turn = 1; ; turn++) {
      if (closed()) {
        rec.endedBy = 'agent_hangup';
        break;
      }
      if (turn > o.maxTurns) {
        rec.endedBy = 'max_turns';
        break;
      }
      if (now() - t0 > o.maxCallMs) {
        rec.endedBy = 'max_duration';
        break;
      }
      const move = await tester.next(agentSaid || '(silence on the line)', []);
      ev({ type: 'caller.plan', turn, plan: move.plan, approach: move.approach, speaker: tester.model });
      // The agent may have kept talking while the tester thought; record it as part of the same reply.
      const extra = findSegment(phone.heard(), lastEnd, listenOpts);
      let carried = '';
      if (extra) {
        const more = await listen(turn - 1, lastEnd, 2);
        if (more) {
          lastEnd = more.end;
          carried = more.text;
        }
      }
      let playedFrom = phone.heard().length;
      if (move.say) {
        const pcm = await voice.speak(move.say);
        const padded = withSilence(pcm, 0.2, 240);
        if (closed()) {
          // The agent hung up while the line was being prepared; it was never said.
          ev({ type: 'caller.unsaid', turn, text: move.say, reason: 'call closed before playback' });
          rec.endedBy = 'agent_hangup';
          break;
        }
        playedFrom = phone.heard().length;
        const { path } = await phone.play(padded, `${runId}-turn-${turn}`);
        rec.callerLines.push(move.say);
        rec.turns = turn;
        ev({ type: 'caller.turn', turn, text: move.say, audio: { path, sha256: sha(wavBytes(pcm)), seconds: Number(seconds(pcm).toFixed(2)) }, tts: voice.tts });
        await sleep(Math.round(seconds(pcm) * 1000) + 300);
      }
      if (move.keys) {
        await phone.dtmf(move.keys);
        ev({ type: 'caller.keys', turn, digits: move.keys, method: 'sip-dtmf' });
      }
      if (move.endCall) {
        rec.endedBy = 'caller_end';
        if (move.say) await listen(turn, playedFrom, 1, 8000).catch(() => null); // let the agent answer the goodbye
        break;
      }
      const reply = await listen(turn, playedFrom);
      if (!reply) {
        ev({ type: 'agent.silent', turn });
        agentSaid = carried;
        continue;
      }
      lastEnd = reply.end;
      agentSaid = carried ? `${carried} ... ${reply.text}` : reply.text;
    }
  } catch (e) {
    rec.endedBy = 'error';
    rec.error = (e as Error).message;
    ev({ type: 'run.error', error: rec.error });
  }
  const agentHungUp = closed();
  try {
    await phone.hangup();
  } catch (e) {
    rec.error ??= 'hangup: ' + (e as Error).message;
  }
  ev({ type: 'call.closed', by: agentHungUp ? 'agent' : 'caller', callId: rec.callId });
  rec.ms = now() - t0;
  return { ...rec, eventsPath };
}

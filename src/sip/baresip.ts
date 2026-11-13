// Baresip softphone driver (demo layer only). One container per call, sharing the local LiveKit container's network
// namespace so the call stays on loopback SIP/RTP: no carrier, no PSTN. Commands go to Baresip's console on stdin
// (the only path that sends keypad DTMF in Baresip 1.0); structured call events come from its ctrl_tcp socket.
// Caller audio is switched per turn with /ausrc; the agent's decoded audio is read from the sndfile dump as it grows.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWav, wavBytes, type Pcm } from './wav.ts';

export interface PhoneEvent {
  t: string;
  type: string; // Baresip UA event, e.g. CALL_RINGING, CALL_ESTABLISHED, CALL_CLOSED
  id?: string; // SIP Call-ID
  param?: string;
}

export interface Phone {
  /** Presented identity, parsed from the account line (never the credentials). */
  readonly from: { displayName: string; uri: string; user: string };
  dial(uri: string, timeoutMs?: number): Promise<{ callId: string }>;
  /** Make `audio` the outgoing source from now on; it should end in silence long enough to cover the next wait. */
  play(audio: Pcm, label: string): Promise<{ path: string }>;
  dtmf(digits: string): Promise<void>;
  /** Everything the caller has heard from the agent so far (decoded, 8 kHz). */
  heard(): Int16Array;
  readonly rate: number;
  /** The softphone process has exited. */
  readonly closed: boolean;
  /** The call has closed (either side hung up). */
  readonly callClosed: boolean;
  hangup(): Promise<void>;
  close(): Promise<void>;
  /** Paths of the native caller-side recordings for this call (outgoing and decoded incoming audio). */
  recordings(): { sent?: string; heard?: string };
}

export interface BaresipConfig {
  hostDir: string; // bind-mounted as /phone: config, accounts, audio/, dumps/
  image: string;
  network: string; // container whose network namespace the phone joins
  container: string;
  log: string; // file receiving the console and event stream
}

export function parseAccount(line: string): Phone['from'] {
  const m = line.match(/^\s*(?:"([^"]*)"\s*)?<sip:([^@>;]+)@([^>;]+)>/);
  if (!m) throw new Error('cannot parse Baresip account line');
  return { displayName: m[1] ?? '', user: m[2], uri: `sip:${m[2]}@${m[3]}` };
}

/** Parse ctrl_tcp netstrings ("<len>:<json>,"); returns parsed messages and the unconsumed remainder. */
export function parseNetstrings(buf: string): { messages: any[]; rest: string } {
  const messages: any[] = [];
  let rest = buf;
  for (;;) {
    const colon = rest.indexOf(':');
    if (colon < 1) break;
    const len = Number(rest.slice(0, colon));
    if (!Number.isInteger(len)) throw new Error('bad netstring length');
    if (rest.length < colon + 1 + len + 1) break;
    messages.push(JSON.parse(rest.slice(colon + 1, colon + 1 + len)));
    rest = rest.slice(colon + 1 + len + 1);
  }
  return { messages, rest };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BaresipPhone implements Phone {
  readonly rate = 8000;
  readonly from: Phone['from'];
  readonly events: PhoneEvent[] = [];
  private readonly cfg: BaresipConfig;
  private proc: ChildProcess | null = null;
  private ctrl: ChildProcess | null = null;
  private console = '';
  private callId: string | null = null;
  private dumpsBefore = new Set<string>();
  private heardPath: string | null = null;
  private heardFd: number | null = null;
  private heardBytes = Buffer.alloc(0);
  private ended = false;

  constructor(cfg: BaresipConfig) {
    this.cfg = cfg;
    this.from = parseAccount(readFileSync(join(cfg.hostDir, 'accounts'), 'utf8').split('\n').find((l) => l.trim() && !l.trim().startsWith('#')) ?? '');
    mkdirSync(join(cfg.hostDir, 'audio'), { recursive: true });
    mkdirSync(join(cfg.hostDir, 'dumps'), { recursive: true });
  }

  get closed(): boolean {
    return this.ended;
  }

  private note(line: string) {
    appendFileSync(this.cfg.log, `${new Date().toISOString()} ${line}\n`);
  }

  private async waitFor<T>(check: () => T | undefined | null | false, timeoutMs: number, what: string): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = check();
      if (v) return v;
      if (Date.now() > deadline) throw new Error(`softphone: timed out waiting for ${what}`);
      await sleep(50);
    }
  }

  async start(): Promise<void> {
    const proc = spawn('docker', ['run', '--rm', '-i', '--name', this.cfg.container, '--network', `container:${this.cfg.network}`,
      '-v', `${this.cfg.hostDir}:/phone`, this.cfg.image, '-f', '/phone'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    const onOut = (d: Buffer) => {
      const s = d.toString('utf8');
      this.console += s;
      // The console echoes each typed key; keep the log readable by dropping the echo lines.
      for (const line of s.split('\n')) if (line.trim() && !line.startsWith('//')) this.note('console ' + line.trimEnd());
    };
    proc.stdout!.on('data', onOut);
    proc.stderr!.on('data', onOut);
    proc.on('exit', (code) => {
      this.ended = true;
      this.note(`console exited ${code}`);
    });
    await this.waitFor(() => this.console.includes('baresip is ready.') || this.ended, 20_000, 'Baresip to start');
    if (this.ended) throw new Error('softphone exited during start-up');
    let buf = '';
    const ctrl = spawn('docker', ['exec', '-i', this.cfg.container, 'bash', '-c', 'exec 3<>/dev/tcp/127.0.0.1/4444; cat <&3'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.ctrl = ctrl;
    ctrl.stdout!.on('data', (d: Buffer) => {
      const r = parseNetstrings(buf + d.toString('utf8'));
      buf = r.rest;
      for (const m of r.messages) {
        if (!m.event) continue;
        const e: PhoneEvent = { t: new Date().toISOString(), type: String(m.type), id: m.id, param: m.param };
        this.events.push(e);
        this.note('event ' + JSON.stringify(e));
      }
    });
    await sleep(500); // let the event socket attach before dialing
  }

  private send(text: string) {
    if (!this.proc || this.ended) throw new Error('softphone is not running');
    this.proc.stdin!.write(text);
  }

  async dial(uri: string, timeoutMs = 45_000): Promise<{ callId: string }> {
    this.dumpsBefore = new Set(readdirSync(join(this.cfg.hostDir, 'dumps')));
    this.send(`/dial ${uri}\n`);
    const e = await this.waitFor(() => this.events.find((x) => x.type === 'CALL_ESTABLISHED' || x.type === 'CALL_CLOSED'), timeoutMs, 'the call to be answered');
    if (e.type !== 'CALL_ESTABLISHED' || !e.id) throw new Error(`call not established: ${e.type} ${e.param ?? ''}`);
    this.callId = e.id;
    return { callId: e.id };
  }

  async play(audio: Pcm, label: string): Promise<{ path: string }> {
    if (audio.rate !== this.rate) throw new Error(`phone audio must be ${this.rate} Hz`);
    const name = label.replace(/[^A-Za-z0-9._-]/g, '_') + '.wav';
    const host = join(this.cfg.hostDir, 'audio', name);
    writeFileSync(host, wavBytes(audio));
    const mark = this.console.length;
    this.send(`/ausrc aufile,/phone/audio/${name}\n`);
    await this.waitFor(() => this.console.slice(mark).includes('switch audio device') || this.ended, 3000, 'the audio source switch');
    await sleep(300);
    const out = this.console.slice(mark);
    if (/failed to set audio-source|set_source failed/.test(out)) throw new Error('softphone rejected the audio source: ' + out.slice(-200));
    return { path: host };
  }

  async dtmf(digits: string): Promise<void> {
    // Outside a call, Baresip's console treats a digit as the start of a new dial string. Never send one then.
    if (!this.callId || this.callClosed) throw new Error('no active call for DTMF');
    for (const d of digits) {
      if (!/[0-9*#]/.test(d)) continue;
      this.send(d);
      await sleep(400);
    }
  }

  heard(): Int16Array {
    if (!this.heardPath) {
      const dir = join(this.cfg.hostDir, 'dumps');
      const fresh = readdirSync(dir).filter((f) => f.endsWith('-dec.wav') && !this.dumpsBefore.has(f)).sort();
      if (!fresh.length) return new Int16Array(0);
      this.heardPath = join(dir, fresh.at(-1)!);
      this.heardFd = openSync(this.heardPath, 'r');
    }
    const size = statSync(this.heardPath).size;
    if (size > this.heardBytes.length) {
      const more = Buffer.alloc(size - this.heardBytes.length);
      readSync(this.heardFd!, more, 0, more.length, this.heardBytes.length);
      this.heardBytes = Buffer.concat([this.heardBytes, more]);
    }
    if (this.heardBytes.length < 44) return new Int16Array(0);
    return parseWav(this.heardBytes).samples;
  }

  recordings(): { sent?: string; heard?: string } {
    const heard = this.heardPath ?? undefined;
    const sent = heard?.replace(/-dec\.wav$/, '-enc.wav');
    return { heard, sent: sent && existsSync(sent) ? sent : undefined };
  }

  async hangup(): Promise<void> {
    if (this.ended || !this.callId) return;
    if (this.events.some((e) => e.type === 'CALL_CLOSED')) return;
    this.send('/hangup\n');
    await this.waitFor(() => this.events.some((e) => e.type === 'CALL_CLOSED'), 10_000, 'the call to close').catch(() => undefined);
  }

  async close(): Promise<void> {
    if (!this.ended) {
      try {
        this.send('/quit\n');
      } catch {
        /* already gone */
      }
      await this.waitFor(() => this.ended, 5000, 'Baresip to quit').catch(() => undefined);
    }
    if (!this.ended) spawn('docker', ['rm', '-f', this.cfg.container], { stdio: 'ignore' });
    this.ctrl?.kill();
    if (this.heardFd !== null) closeSync(this.heardFd);
    this.heardFd = null;
  }

  /** True once the far end has hung up (or the call otherwise closed). */
  get callClosed(): boolean {
    return this.events.some((e) => e.type === 'CALL_CLOSED');
  }
}

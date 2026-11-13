// The tester's mouth and ears on a phone line: text-to-speech for its lines, speech-to-text for what it hears.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ProviderError } from '../providers/index.ts';
import { fromRawPcm, parseWav, resample, seconds, wavBytes, PHONE_RATE, type Pcm } from './wav.ts';

export interface VoiceUsage {
  ttsRequests: number;
  ttsChars: number;
  ttsSeconds: number;
  sttRequests: number;
  sttSeconds: number;
  sttInputTokens: number;
  sttOutputTokens: number;
}

export interface Voice {
  readonly tts: string;
  readonly stt: string;
  readonly usage: VoiceUsage;
  speak(text: string): Promise<Pcm>; // 8 kHz
  transcribe(audio: Pcm): Promise<string>;
}

const emptyUsage = (): VoiceUsage => ({ ttsRequests: 0, ttsChars: 0, ttsSeconds: 0, sttRequests: 0, sttSeconds: 0, sttInputTokens: 0, sttOutputTokens: 0 });

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable || n >= retries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** n));
    }
  }
}

export class OpenAIVoice implements Voice {
  readonly tts: string;
  readonly stt: string;
  readonly usage = emptyUsage();
  private readonly key: string;
  private readonly voice: string;
  private readonly fetcher: typeof fetch;
  constructor(key: string, opts: { tts?: string; stt?: string; voice?: string } = {}, fetcher: typeof fetch = fetch) {
    this.key = key;
    this.tts = 'openai:' + (opts.tts ?? 'gpt-4o-mini-tts');
    this.stt = 'openai:' + (opts.stt ?? 'gpt-4o-mini-transcribe');
    this.voice = opts.voice ?? 'alloy';
    this.fetcher = fetcher;
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    let r: Response;
    try {
      r = await this.fetcher('https://api.openai.com/v1/' + path, { ...init, headers: { Authorization: 'Bearer ' + this.key, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      throw new ProviderError(0, 'network: ' + (e as Error).message);
    }
    if (!r.ok) throw new ProviderError(r.status, `http ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r;
  }

  async speak(text: string): Promise<Pcm> {
    const r = await withRetry(() => this.call('audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.tts.slice(7), voice: this.voice, input: text, response_format: 'pcm', instructions: 'A person speaking naturally on a phone call.' }),
    }));
    const pcm = resample(fromRawPcm(Buffer.from(await r.arrayBuffer()), 24000), PHONE_RATE); // `pcm` is 24 kHz 16-bit mono
    this.usage.ttsRequests++;
    this.usage.ttsChars += text.length;
    this.usage.ttsSeconds += seconds(pcm);
    return pcm;
  }

  async transcribe(audio: Pcm): Promise<string> {
    const r = await withRetry(() => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(wavBytes(audio))], { type: 'audio/wav' }), 'agent.wav');
      form.append('model', this.stt.slice(7));
      form.append('response_format', 'json');
      return this.call('audio/transcriptions', { method: 'POST', body: form });
    });
    const j = (await r.json()) as { text?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    this.usage.sttRequests++;
    this.usage.sttSeconds += seconds(audio);
    this.usage.sttInputTokens += j.usage?.input_tokens ?? 0;
    this.usage.sttOutputTokens += j.usage?.output_tokens ?? 0;
    return (j.text ?? '').trim();
  }
}

/**
 * $0 voice for transport tests: macOS `say` for speech, and no transcription at all (it reports only how much audio
 * was heard). Never used for a test verdict; the echo run only proves audio flows both ways and turns are detected.
 */
export class LocalVoice implements Voice {
  readonly tts = 'local:say';
  readonly stt = 'none';
  readonly usage = emptyUsage();
  async speak(text: string): Promise<Pcm> {
    const dir = mkdtempSync(join(tmpdir(), 'faultline-say-'));
    try {
      const out = join(dir, 'line.wav');
      await promisify(execFile)('say', ['-o', out, '--file-format=WAVE', `--data-format=LEI16@${PHONE_RATE}`, text]);
      const pcm = parseWav(readFileSync(out));
      this.usage.ttsRequests++;
      this.usage.ttsChars += text.length;
      this.usage.ttsSeconds += seconds(pcm);
      return pcm;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  async transcribe(audio: Pcm): Promise<string> {
    this.usage.sttRequests++;
    this.usage.sttSeconds += seconds(audio);
    return `[${seconds(audio).toFixed(1)} s of audio; not transcribed]`;
  }
}

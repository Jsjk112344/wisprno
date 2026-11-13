// 16-bit mono PCM WAV helpers for the SIP demo layer. Telephone audio is 8 kHz.

export const PHONE_RATE = 8000;

export interface Pcm {
  rate: number;
  samples: Int16Array;
}

/**
 * Parse a 16-bit mono WAV. Tolerates a file that is still being written (Baresip's sndfile dump): the data chunk's
 * declared size may be 0 or stale, so the data is taken to the end of the buffer.
 */
export function parseWav(buf: Buffer): Pcm {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let rate = 0;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      const format = buf.readUInt16LE(off + 8);
      const channels = buf.readUInt16LE(off + 10);
      rate = buf.readUInt32LE(off + 12);
      const bits = buf.readUInt16LE(off + 22);
      if (format !== 1 || channels !== 1 || bits !== 16) throw new Error(`unsupported WAV: format ${format}, ${channels} ch, ${bits} bit`);
    } else if (id === 'data') {
      if (!rate) throw new Error('WAV data before fmt');
      const start = off + 8;
      const end = buf.length - ((buf.length - start) % 2);
      const samples = new Int16Array(end - start >> 1);
      for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(start + i * 2);
      return { rate, samples };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

export function wavBytes(p: Pcm): Buffer {
  const data = p.samples.length * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(p.rate, 24);
  b.writeUInt32LE(p.rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(data, 40);
  for (let i = 0; i < p.samples.length; i++) b.writeInt16LE(p.samples[i], 44 + i * 2);
  return b;
}

/** Raw little-endian 16-bit PCM (e.g. OpenAI TTS `pcm`, 24 kHz) to samples. */
export function fromRawPcm(buf: Buffer, rate: number): Pcm {
  const samples = new Int16Array(buf.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = buf.readInt16LE(i * 2);
  return { rate, samples };
}

/** Resample to `rate` with a box low-pass (averaging over the source span). Adequate for narrowband speech. */
export function resample(p: Pcm, rate: number): Pcm {
  if (p.rate === rate) return p;
  const ratio = p.rate / rate;
  const n = Math.floor(p.samples.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b && j < p.samples.length; j++) sum += p.samples[j];
    out[i] = Math.round(sum / (b - a));
  }
  return { rate, samples: out };
}

export function withSilence(p: Pcm, leadSeconds: number, tailSeconds: number): Pcm {
  const lead = Math.round(leadSeconds * p.rate);
  const out = new Int16Array(lead + p.samples.length + Math.round(tailSeconds * p.rate));
  out.set(p.samples, lead);
  return { rate: p.rate, samples: out };
}

export const seconds = (p: Pcm): number => p.samples.length / p.rate;

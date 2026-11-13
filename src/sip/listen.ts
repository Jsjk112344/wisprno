// End-of-turn detection on the agent's decoded audio, as a caller would hear it. Energy-based: on the local line the
// agent's speech measures ~2000 RMS and silence ~3 (spike recording), so a fixed threshold separates them cleanly.
// Pauses inside one reply (e.g. while a tool runs) reached ~1.4 s in the spike, hence the 1.8 s end-of-turn default.

export interface ListenOptions {
  rate: number;
  frameMs?: number;
  threshold?: number;
  /** Speech shorter than this is ignored as a click or line noise. */
  minSpeechMs?: number;
  endSilenceMs?: number;
}

export interface Segment {
  start: number; // sample index of the first speech frame
  end: number; // sample index just after the last speech frame
  complete: boolean; // followed by at least endSilenceMs of silence
}

function frameRms(s: Int16Array, from: number, len: number): number {
  let sum = 0;
  for (let i = from; i < from + len; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / len);
}

/**
 * Find the first stretch of speech at or after `from`. Returns null when no speech has started yet.
 * `complete` is false while the speaker may still be talking (not enough trailing silence yet).
 */
export function findSegment(samples: Int16Array, from: number, o: ListenOptions): Segment | null {
  const frame = Math.round(o.rate * (o.frameMs ?? 20) / 1000);
  const threshold = o.threshold ?? 300;
  const minSpeech = Math.max(1, Math.round((o.minSpeechMs ?? 120) / (o.frameMs ?? 20)));
  const endFrames = Math.round((o.endSilenceMs ?? 1800) / (o.frameMs ?? 20));
  let start = -1;
  let lastSpeechEnd = -1;
  let run = 0;
  let quiet = 0;
  for (let i = from; i + frame <= samples.length; i += frame) {
    const loud = frameRms(samples, i, frame) > threshold;
    if (start < 0) {
      if (loud) {
        run++;
        if (run >= minSpeech) {
          start = i - (run - 1) * frame;
          lastSpeechEnd = i + frame;
        }
      } else run = 0;
      continue;
    }
    if (loud) {
      lastSpeechEnd = i + frame;
      quiet = 0;
    } else if (++quiet >= endFrames) {
      return { start, end: lastSpeechEnd, complete: true };
    }
  }
  return start < 0 ? null : { start, end: lastSpeechEnd, complete: false };
}

/**
 * While the agent is still talking: the end of the first stretch from `from` that holds at least `chunkSpeechMs` of
 * speech and is followed by a pause of `chunkPauseMs`. Lets the caller transcribe a long reply in pieces as it is spoken,
 * so only the last piece is left when the turn ends. Returns null until such a pause has happened.
 */
export function nextChunkEnd(samples: Int16Array, from: number, o: ListenOptions & { chunkSpeechMs?: number; chunkPauseMs?: number }): number | null {
  const frameMs = o.frameMs ?? 20;
  const frame = Math.round(o.rate * frameMs / 1000);
  const threshold = o.threshold ?? 300;
  const needSpeech = Math.round((o.chunkSpeechMs ?? 1500) / frameMs);
  const needPause = Math.round((o.chunkPauseMs ?? 400) / frameMs);
  let speech = 0;
  let quiet = 0;
  let lastLoudEnd = -1;
  for (let i = from; i + frame <= samples.length; i += frame) {
    if (frameRms(samples, i, frame) > threshold) {
      speech++;
      quiet = 0;
      lastLoudEnd = i + frame;
    } else if (lastLoudEnd >= 0 && ++quiet >= needPause && speech >= needSpeech) {
      return lastLoudEnd;
    }
  }
  return null;
}

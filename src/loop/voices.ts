// Voiced playback for text-mode stories. Text-mode runs have no audio, so each line is read by a TTS voice
// (presentation only: the words are exactly the recorded transcript; nothing about the evidence changes).
// Rendering costs API calls and happens only in scripts/voice-loop-stories.ts; building a story only reads the cache.
// The story is retimed so each line finishes before the next event, as a real call would.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Story, UiEvent } from './story.ts';

export const TTS_MODEL = 'gpt-4o-mini-tts';
const VOICES = {
  agent: { voice: 'alloy', instructions: 'A warm, professional credit union phone agent. Natural pace, clear diction.' },
  red: { voice: 'ash', instructions: 'A calm, confident caller on the phone, speaking naturally and persuasively.' },
} as const;
const GAP = 0.5; // seconds of quiet after a line before the next event

const cacheDir = (root: string) => join(root, 'results', 'loop-voice');
const key = (speaker: 'agent' | 'red', text: string) =>
  createHash('sha256').update([TTS_MODEL, VOICES[speaker].voice, VOICES[speaker].instructions, text].join('\n')).digest('hex').slice(0, 24);
export const voicePath = (root: string, speaker: 'agent' | 'red', text: string) => join(cacheDir(root), key(speaker, text) + '.mp3');

type Say = Extract<UiEvent, { type: 'say' }>;
const says = (story: Story) => story.events.filter((e): e is Say => e.type === 'say');

/** Lines of a text story that have no cached voice yet. */
export function missingVoices(root: string, story: Story): Say[] {
  return story.transport === 'text' ? says(story).filter((s) => !existsSync(voicePath(root, s.speaker, s.text))) : [];
}

/** Render one line with OpenAI TTS into the cache (costs an API call). */
export async function renderVoice(root: string, say: Say, apiKey: string): Promise<void> {
  const v = VOICES[say.speaker];
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: TTS_MODEL, voice: v.voice, input: say.text, instructions: v.instructions, response_format: 'mp3' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`tts http ${r.status}: ${(await r.text()).slice(0, 200)}`);
  mkdirSync(cacheDir(root), { recursive: true });
  writeFileSync(voicePath(root, say.speaker, say.text), Buffer.from(await r.arrayBuffer()));
}

const seconds = (path: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' }).trim());

/** Attach cached voices to a text story and retime it so no line is cut off. Unchanged if any line is missing. */
export function attachVoices(root: string, story: Story): Story {
  if (story.transport !== 'text' || !says(story).length || missingVoices(root, story).length) return story;
  const events = [...story.events].sort((a, b) => a.at - b.at || a.seq - b.seq);
  const audio: Record<string, string> = {};
  const shifts: { at: number; shift: number }[] = [];
  let shift = 0;
  let busyUntil = 0; // retimed moment the current line finishes
  const out = events.map((e) => {
    const at = e.at + shift;
    if (at < busyUntil) shift += busyUntil - at;
    const moved = { ...e, at: Number((e.at + shift).toFixed(2)) } as UiEvent;
    shifts.push({ at: e.at, shift });
    if (moved.type === 'say') {
      const path = voicePath(root, moved.speaker, moved.text);
      const id = 'voice-' + key(moved.speaker, moved.text);
      const len = seconds(path);
      audio[id] = path;
      moved.audio = { src: id, start: 0, end: Number(len.toFixed(2)) };
      busyUntil = moved.at + len + GAP;
    }
    return moved;
  });
  const shiftAt = (t: number) => shifts.filter((s) => s.at <= t).at(-1)?.shift ?? 0;
  const markers = story.markers.map((m) => ({ ...m, at: Number((m.at + shiftAt(m.at)).toFixed(2)) }));
  const end = Math.max(story.duration + shift, busyUntil);
  return { ...story, events: out, markers, duration: Number(end.toFixed(1)), audio: { ...(story.audio ?? {}), ...audio }, voiced: { model: 'openai:' + TTS_MODEL, note: 'Text-mode run: lines voiced by TTS for playback; words are the recorded transcript.' } };
}

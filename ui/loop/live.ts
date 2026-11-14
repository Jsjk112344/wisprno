// Served-mode client: only talks to the local Wisprno server that served this page (same origin).
// Opened as a file, every call here fails fast and the page stays in playback-only mode.
import type { LiveMessage, ServerStatus, Story, UiEvent } from '../../src/loop/story.ts';

export async function fetchStatus(): Promise<ServerStatus | null> {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
  try {
    const response = await fetch('/api/status', { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const status = await response.json() as ServerStatus;
    return status?.served ? status : null;
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}) });
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let message = raw;
    try { message = (JSON.parse(raw) as { error?: string }).error ?? raw; } catch { /* not JSON */ }
    throw new Error(message || `${path}: HTTP ${response.status}`);
  }
  return await response.json() as T;
}

export const startLive = (mode: 'loop' | 'sip') => post<{ id: string }>('/api/live', { mode });

export const decideFix = (id: string, candidate: string, approved: boolean) => post(`/api/live/${encodeURIComponent(id)}/decision`, { candidate, approved });

/** Opens the live stream; returns a function that closes it. */
export function streamLive(id: string, onMessage: (message: LiveMessage) => void, onBroken: (message: string) => void) {
  const source = new EventSource(`/api/live/${encodeURIComponent(id)}/stream`);
  let finished = false;
  source.onmessage = (raw) => {
    let message: LiveMessage;
    try { message = JSON.parse(raw.data) as LiveMessage; } catch { return; }
    if (message.kind === 'done' || message.kind === 'error') { finished = true; source.close(); }
    onMessage(message);
  };
  source.onerror = () => {
    if (finished) return;
    finished = true;
    source.close();
    onBroken('Live stream disconnected');
  };
  return () => { finished = true; source.close(); };
}

export const judgeStart = () =>
  post<{ id: string; story: Omit<Story, 'events'>; events: UiEvent[] }>('/api/judge/start', {});
export const judgeTurn = (id: string, text: string) =>
  post<{ events: UiEvent[] }>(`/api/judge/${encodeURIComponent(id)}/turn`, { text });

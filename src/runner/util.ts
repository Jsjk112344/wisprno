import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, path);
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function readJsonIf<T>(path: string): T | null {
  return existsSync(path) ? readJson<T>(path) : null;
}

export function appendLine(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(data) + '\n');
}

/** Run tasks with at most `limit` in flight. Results keep input order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Wilson score interval, 95%. Returns [low, high] as proportions. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}

export function fmtCount(k: number, n: number): string {
  const [lo, hi] = wilson(k, n);
  return `${k}/${n} (95% CI ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%)`;
}

export const pad2 = (n: number): string => String(n).padStart(2, '0');

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

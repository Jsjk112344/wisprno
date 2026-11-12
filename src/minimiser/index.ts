// Minimiser: freeze the tester's lines from a failing call, then remove turns one at a time, keeping a removal only
// if the shorter script still fails in at least half of 10 replays. Replays stop early once the outcome is decided.

export interface ReplayTally {
  runs: number;
  fails: number;
  inconclusive: number;
}

export type ReplayOnce = (lines: string[]) => Promise<{ failed: boolean; inconclusive: boolean }>;

/**
 * Replay `lines` up to n times with `concurrency` in flight. With `needFails`, stop as soon as the threshold is reached
 * or can no longer be reached. With `stopOnFirstFail`, stop at the first failure (used for 0-of-20 checks).
 * Inconclusive replays count as not failing (conservative for minimisation) and are reported.
 */
export async function replayN(
  once: ReplayOnce,
  lines: string[],
  n: number,
  concurrency: number,
  opts: { needFails?: number; stopOnFirstFail?: boolean } = {},
): Promise<ReplayTally> {
  const t: ReplayTally = { runs: 0, fails: 0, inconclusive: 0 };
  let started = 0;
  const decided = () => {
    if (opts.stopOnFirstFail && t.fails > 0) return true;
    if (opts.needFails !== undefined) {
      if (t.fails >= opts.needFails) return true;
      const remaining = n - t.runs - (started - t.runs);
      if (t.fails + (started - t.runs) + remaining < opts.needFails) return true;
    }
    return false;
  };
  const worker = async () => {
    while (started < n && !decided()) {
      started++;
      const r = await once(lines);
      t.runs++;
      if (r.failed) t.fails++;
      else if (r.inconclusive) t.inconclusive++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, n)) }, worker));
  return t;
}

export interface MinimiseStep {
  removedIndex: number | null;
  lines: string[];
  tally: ReplayTally;
  kept: boolean;
}

export interface MinimiseResult {
  reproducible: boolean;
  lines: string[];
  /** Fails out of runs for the final script (at least 5 of 10 when reproducible). */
  final: ReplayTally;
  steps: MinimiseStep[];
}

export const MIN_REPLAYS = 10;
export const MIN_FAILS = 5;

export async function minimise(once: ReplayOnce, lines: string[], concurrency: number, maxCandidates = 14): Promise<MinimiseResult> {
  const steps: MinimiseStep[] = [];
  const check = (ls: string[]) => replayN(once, ls, MIN_REPLAYS, concurrency, { needFails: MIN_FAILS });
  let current = [...lines];
  let tally = await check(current);
  steps.push({ removedIndex: null, lines: current, tally, kept: tally.fails >= MIN_FAILS });
  if (tally.fails < MIN_FAILS) return { reproducible: false, lines: current, final: tally, steps };
  let i = 0;
  let tried = 0;
  while (i < current.length && current.length > 1 && tried < maxCandidates) {
    const candidate = current.filter((_, j) => j !== i);
    tried++;
    const t = await check(candidate);
    const kept = t.fails >= MIN_FAILS;
    steps.push({ removedIndex: i, lines: candidate, tally: t, kept });
    if (kept) {
      current = candidate;
      tally = t;
    } else {
      i++;
    }
  }
  return { reproducible: true, lines: current, final: tally, steps };
}

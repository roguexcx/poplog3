import type { ApiName, EngineLogEntry, EngineStats } from "./types";

const MAX = 500;
const API_NAMES: ApiName[] = ["tmdb", "omdb", "watchmode", "motn", "balloonerismm", "tvdb", "trakt"];

type Counter = {
  calls: number;
  hits: number;
  errors: number;
  totalMs: number;
  maxMs: number;
};

type Store = {
  buf: (EngineLogEntry | undefined)[];
  head: number;
  seq: number;
  startedAt: number;
  perApi: Record<ApiName, Counter>;
  perOrigin: Record<string, number>;
};

function makeStore(): Store {
  return {
    buf: Array(MAX).fill(undefined),
    head: 0,
    seq: 0,
    startedAt: Date.now(),
    perApi: Object.fromEntries(
      API_NAMES.map((n) => [n, { calls: 0, hits: 0, errors: 0, totalMs: 0, maxMs: 0 }]),
    ) as Record<ApiName, Counter>,
    perOrigin: {},
  };
}

// Singleton ancorado no globalThis para sobreviver ao HMR do Next.js dev.
const g = globalThis as typeof globalThis & { __engineStore?: Store };
if (!g.__engineStore) g.__engineStore = makeStore();
const S = g.__engineStore;

export function push(entry: Omit<EngineLogEntry, "id">): EngineLogEntry {
  const full: EngineLogEntry = { ...entry, id: ++S.seq };
  S.buf[S.head] = full;
  S.head = (S.head + 1) % MAX;

  const c = S.perApi[entry.api];
  if (c) {
    c.calls++;
    if (!entry.success) c.errors++;
    if (entry.cacheStatus === "hit") c.hits++;
    c.totalMs += entry.durationMs;
    if (entry.durationMs > c.maxMs) c.maxMs = entry.durationMs;
  }

  S.perOrigin[entry.origin] = (S.perOrigin[entry.origin] ?? 0) + 1;

  return full;
}

function getAll(): EngineLogEntry[] {
  const out: EngineLogEntry[] = [];
  for (let i = 0; i < MAX; i++) {
    const e = S.buf[i];
    if (e) out.push(e);
  }
  return out.sort((a, b) => b.ts - a.ts);
}

function p95(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
}

export function getEntries(limit = 50): EngineLogEntry[] {
  return getAll().slice(0, limit);
}

export function getStats(): EngineStats {
  const all = getAll();
  let totalHits = 0;
  let totalCalls = 0;

  const apiStats = {} as Record<ApiName, EngineStats["perApi"][ApiName]>;

  for (const name of API_NAMES) {
    const c = S.perApi[name]!;
    const durations = all.filter((e) => e.api === name).map((e) => e.durationMs);
    const misses = Math.max(0, c.calls - c.hits - c.errors);
    apiStats[name] = {
      calls: c.calls,
      hits: c.hits,
      misses,
      errors: c.errors,
      avgMs: c.calls > 0 ? Math.round(c.totalMs / c.calls) : 0,
      maxMs: c.maxMs,
      p95Ms: p95(durations),
      hitRate: c.calls > 0 ? Math.round((c.hits / c.calls) * 100) : 0,
    };
    totalHits += c.hits;
    totalCalls += c.calls;
  }

  return {
    startedAt: S.startedAt,
    uptimeMs: Date.now() - S.startedAt,
    totalCalls,
    cacheHitRate: totalCalls > 0 ? Math.round((totalHits / totalCalls) * 100) : 0,
    perApi: apiStats,
    perOrigin: { ...S.perOrigin },
    recentErrors: all.filter((e) => !e.success).slice(0, 20),
  };
}

export function clear(): void {
  S.buf.fill(undefined);
  S.head = 0;
  S.seq = 0;
  S.startedAt = Date.now();
  for (const name of API_NAMES) {
    const c = S.perApi[name]!;
    c.calls = 0;
    c.hits = 0;
    c.errors = 0;
    c.totalMs = 0;
    c.maxMs = 0;
  }
  for (const k of Object.keys(S.perOrigin)) delete S.perOrigin[k];
}

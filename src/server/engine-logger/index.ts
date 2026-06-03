import { push } from "./store";
import { getOrigin } from "./context";
import { persistEngineLogEntry, getPersistentSnapshot, clearPersistentEntries } from "./persistence";
import type { EngineLogEntry } from "./types";

export { withOrigin } from "./context";
export { getStats, getEntries, clear } from "./store";
export { clearPersistentEntries, getPersistentSnapshot } from "./persistence";
export type { EngineLogEntry, EngineStats, ApiStats, Origin, ApiName, CacheStatus } from "./types";

type LogInput = Omit<EngineLogEntry, "id" | "ts" | "origin"> & {
  origin?: EngineLogEntry["origin"];
};

export function logApiCall(input: LogInput): void {
  const entry = push({
    ...input,
    ts: Date.now(),
    origin: input.origin ?? getOrigin(),
  });
  void persistEngineLogEntry(entry);
}

// ── API History ────────────────────────────────────────────────────────────────

type Acc = { calls: number; hits: number; errors: number; totalMs: number };

function accToEntry(a: Acc) {
  return {
    calls: a.calls,
    hits: a.hits,
    errors: a.errors,
    avgMs: a.calls > 0 ? Math.round(a.totalMs / a.calls) : 0,
    hitRate: a.calls > 0 ? Math.round((a.hits / a.calls) * 100) : 0,
  };
}

export async function getApiHistory(days: number): Promise<{
  window_days: number;
  generated_at: string;
  totals: Record<string, { totalCalls: number; cacheHits: number; errors: number; avgMs: number; hitRate: number }> | null;
  series: Array<{ day: string; apis: Record<string, { calls: number; hits: number; errors: number; avgMs: number; hitRate: number }> }> | null;
} | null> {
  const snapshot = await getPersistentSnapshot(Math.min(days * 500, 50_000));
  if (!snapshot) return null;

  const since = Date.now() - days * 86_400_000;
  const entries = snapshot.entries.filter((e) => e.ts >= since);

  if (entries.length === 0) {
    return { window_days: days, generated_at: new Date().toISOString(), totals: null, series: null };
  }

  const apiAcc: Record<string, Acc> = {};
  const dayAcc: Record<string, Record<string, Acc>> = {};

  for (const e of entries) {
    const api = String(e.api);
    if (!apiAcc[api]) apiAcc[api] = { calls: 0, hits: 0, errors: 0, totalMs: 0 };
    apiAcc[api].calls++;
    if (!e.success) apiAcc[api].errors++;
    if (e.cacheStatus === "hit") apiAcc[api].hits++;
    apiAcc[api].totalMs += e.durationMs;

    const day = new Date(e.ts).toISOString().slice(0, 10);
    if (!dayAcc[day]) dayAcc[day] = {};
    if (!dayAcc[day][api]) dayAcc[day][api] = { calls: 0, hits: 0, errors: 0, totalMs: 0 };
    dayAcc[day][api].calls++;
    if (!e.success) dayAcc[day][api].errors++;
    if (e.cacheStatus === "hit") dayAcc[day][api].hits++;
    dayAcc[day][api].totalMs += e.durationMs;
  }

  const totals: Record<string, { totalCalls: number; cacheHits: number; errors: number; avgMs: number; hitRate: number }> = {};
  for (const [api, acc] of Object.entries(apiAcc)) {
    totals[api] = {
      totalCalls: acc.calls,
      cacheHits: acc.hits,
      errors: acc.errors,
      avgMs: acc.calls > 0 ? Math.round(acc.totalMs / acc.calls) : 0,
      hitRate: acc.calls > 0 ? Math.round((acc.hits / acc.calls) * 100) : 0,
    };
  }

  const series = Object.entries(dayAcc)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, apis]) => ({
      day,
      apis: Object.fromEntries(Object.entries(apis).map(([api, acc]) => [api, accToEntry(acc)])),
    }));

  return { window_days: days, generated_at: new Date().toISOString(), totals, series };
}

export async function compactApiCallLogs(keepDays: number): Promise<{ ok: boolean; detail: string }> {
  const cleared = await clearPersistentEntries();
  return {
    ok: cleared,
    detail: cleared
      ? `Logs compactados (janela: ${keepDays} dias). Logs raw removidos.`
      : "Falha ao compactar logs persistidos.",
  };
}

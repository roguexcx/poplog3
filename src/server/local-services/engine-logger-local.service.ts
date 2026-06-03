import {
  clearEngineLogEntries,
  createEngineLogEntry,
  type EngineLogEntryRow,
  listRecentEngineLogEntries,
} from "@/server/repositories";
import type { ApiName, EngineLogEntry, EngineStats } from "@/server/engine-logger/types";

const API_NAMES: ApiName[] = ["tmdb", "omdb", "watchmode", "motn", "balloonerismm", "tvdb"];
const PERSISTENCE_WINDOW_HOURS = 24;

type PersistentSnapshot = {
  stats: EngineStats;
  entries: EngineLogEntry[];
  source: "persistent";
};

function rowToEntry(row: EngineLogEntryRow): EngineLogEntry {
  return {
    id: Number(row.id),
    ts: row.ts.getTime(),
    api: row.api as ApiName,
    op: row.op,
    origin: row.origin as EngineLogEntry["origin"],
    mediaType: row.mediaType ?? undefined,
    tmdbId: row.tmdbId ?? undefined,
    endpoint: row.endpoint ?? undefined,
    cacheStatus: row.cacheStatus,
    durationMs: row.durationMs,
    success: row.success,
    httpStatus: row.httpStatus ?? undefined,
    error: row.error ?? undefined,
    fallbackFrom: (row.fallbackFrom ?? undefined) as ApiName | undefined,
  };
}

function emptyApiStats() {
  return { calls: 0, hits: 0, misses: 0, errors: 0, avgMs: 0, maxMs: 0, p95Ms: 0, hitRate: 0 };
}

function buildStats(entries: EngineLogEntry[], recentErrors: EngineLogEntry[]): EngineStats {
  const startedAt = entries.length > 0 ? Math.min(...entries.map((entry) => entry.ts)) : Date.now();
  const perApi = Object.fromEntries(API_NAMES.map((api) => [api, emptyApiStats()])) as EngineStats["perApi"];
  const durationsByApi = Object.fromEntries(API_NAMES.map((api) => [api, [] as number[]]));
  const perOrigin: Record<string, number> = {};
  let hits = 0;

  for (const entry of entries) {
    const stats = perApi[entry.api];
    stats.calls++;
    if (entry.cacheStatus === "hit") {
      stats.hits++;
      hits++;
    }
    if (entry.cacheStatus === "miss") stats.misses++;
    if (!entry.success) stats.errors++;
    stats.maxMs = Math.max(stats.maxMs, entry.durationMs);
    durationsByApi[entry.api].push(entry.durationMs);
    perOrigin[entry.origin] = (perOrigin[entry.origin] ?? 0) + 1;
  }

  for (const api of API_NAMES) {
    const durations = durationsByApi[api].sort((a, b) => a - b);
    const stats = perApi[api];
    if (durations.length > 0) {
      stats.avgMs = Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
      stats.p95Ms = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] ?? 0;
      stats.hitRate = stats.calls > 0 ? Math.round((stats.hits / stats.calls) * 100) : 0;
    }
  }

  return {
    startedAt,
    uptimeMs: Math.max(0, Date.now() - startedAt),
    totalCalls: entries.length,
    cacheHitRate: entries.length > 0 ? Math.round((hits / entries.length) * 100) : 0,
    perApi,
    perOrigin,
    recentErrors,
  };
}

export async function persistEngineLogEntry(entry: EngineLogEntry): Promise<void> {
  await createEngineLogEntry({
    ts: entry.ts,
    api: entry.api,
    op: entry.op,
    origin: entry.origin,
    mediaType: entry.mediaType ?? null,
    tmdbId: entry.tmdbId ?? null,
    endpoint: entry.endpoint ?? null,
    cacheStatus: entry.cacheStatus,
    durationMs: entry.durationMs,
    success: entry.success,
    httpStatus: entry.httpStatus ?? null,
    error: entry.error ?? null,
    fallbackFrom: entry.fallbackFrom ?? null,
  });
}

export async function getPersistentSnapshot(limit: number): Promise<PersistentSnapshot | null> {
  const since = new Date(Date.now() - PERSISTENCE_WINDOW_HOURS * 60 * 60 * 1000);
  const [entriesResult, errorsResult] = await Promise.all([
    listRecentEngineLogEntries({ since, limit }),
    listRecentEngineLogEntries({ since, limit: 20, success: false }),
  ]);

  if (!entriesResult.ok || !errorsResult.ok) return null;

  const entries = entriesResult.data.map(rowToEntry);
  const recentErrors = errorsResult.data.map(rowToEntry);
  return {
    stats: buildStats(entries, recentErrors),
    entries,
    source: "persistent",
  };
}

export async function clearPersistentEntries(): Promise<boolean> {
  const result = await clearEngineLogEntries();
  return result.ok;
}

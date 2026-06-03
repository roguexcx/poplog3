import type { ApiName, EngineLogEntry, EngineStats } from "./types";
import { isLocalLogsEnabled } from "@/server/runtime/local-db-flags";

const API_NAMES: ApiName[] = ["tmdb", "omdb", "watchmode", "motn", "balloonerismm", "tvdb"];
const PERSISTENCE_WINDOW_HOURS = 24;
let persistWarningMutedUntil = 0;

type EngineLogRow = {
  id: number;
  ts: string;
  api: ApiName;
  op: string;
  origin: EngineLogEntry["origin"];
  media_type: EngineLogEntry["mediaType"] | null;
  tmdb_id: number | null;
  endpoint: string | null;
  cache_status: EngineLogEntry["cacheStatus"];
  duration_ms: number;
  success: boolean;
  http_status: number | null;
  error: string | null;
  fallback_from: ApiName | null;
};

type PersistentStatsPayload = {
  summary?: {
    startedAt?: string | null;
    uptimeMs?: number | null;
    totalCalls?: number | null;
    cacheHitRate?: number | null;
  };
  perApi?: EngineStats["perApi"];
  perOrigin?: Record<string, number>;
};

type PersistentSnapshot = {
  stats: EngineStats;
  entries: EngineLogEntry[];
  source: "persistent";
};

export async function persistEngineLogEntry(entry: EngineLogEntry): Promise<void> {
  if (isLocalLogsEnabled()) {
    try {
      const local = await import("@/server/local-services/engine-logger-local.service");
      await local.persistEngineLogEntry(entry);
      return;
    } catch (err) {
      warnPersistOnce("[engine-logger] Local persistence failed, falling back to Supabase:", err);
    }
  }

  try {
    const { supabaseAdmin } = await import("@/server/supabase/admin");
    const { error } = await supabaseAdmin.from("engine_api_call_logs").insert({
      ts: new Date(entry.ts).toISOString(),
      api: entry.api,
      op: entry.op,
      origin: entry.origin,
      media_type: entry.mediaType ?? null,
      tmdb_id: entry.tmdbId ?? null,
      endpoint: entry.endpoint ?? null,
      cache_status: entry.cacheStatus,
      duration_ms: entry.durationMs,
      success: entry.success,
      http_status: entry.httpStatus ?? null,
      error: entry.error ?? null,
      fallback_from: entry.fallbackFrom ?? null,
    });

    if (error) {
      warnPersistOnce("[engine-logger] Falha ao persistir log:", error.message);
    }
  } catch (err) {
    warnPersistOnce(
      "[engine-logger] Persistência indisponível:",
      err instanceof Error ? err.message : err,
    );
  }
}

function warnPersistOnce(message: string, detail: unknown): void {
  const now = Date.now();
  if (now < persistWarningMutedUntil) return;
  persistWarningMutedUntil = now + 60_000;
  console.warn(message, detail);
}

export async function getPersistentSnapshot(limit: number): Promise<PersistentSnapshot | null> {
  if (isLocalLogsEnabled()) {
    try {
      const local = await import("@/server/local-services/engine-logger-local.service");
      const snapshot = await local.getPersistentSnapshot(limit);
      if (snapshot) return snapshot;
    } catch (err) {
      console.warn("[engine-logger] Local snapshot failed, falling back to Supabase:", err);
    }
  }

  try {
    const { supabaseAdmin } = await import("@/server/supabase/admin");
    const since = new Date(Date.now() - PERSISTENCE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    const [statsResult, entriesResult, errorsResult] = await Promise.all([
      supabaseAdmin.rpc("engine_api_call_log_stats", { p_since: since }),
      supabaseAdmin
        .from("engine_api_call_logs")
        .select("*")
        .gte("ts", since)
        .order("ts", { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from("engine_api_call_logs")
        .select("*")
        .gte("ts", since)
        .eq("success", false)
        .order("ts", { ascending: false })
        .limit(20),
    ]);

    if (statsResult.error || entriesResult.error || errorsResult.error) {
      const message =
        statsResult.error?.message ??
        entriesResult.error?.message ??
        errorsResult.error?.message ??
        "erro desconhecido";
      console.warn("[engine-logger] Falha ao ler logs persistidos:", message);
      return null;
    }

    const entries = ((entriesResult.data ?? []) as EngineLogRow[]).map(rowToEntry);
    const recentErrors = ((errorsResult.data ?? []) as EngineLogRow[]).map(rowToEntry);
    const stats = payloadToStats(statsResult.data as PersistentStatsPayload | null, recentErrors);

    return { stats, entries, source: "persistent" };
  } catch (err) {
    console.warn(
      "[engine-logger] Leitura persistente indisponível:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function clearPersistentEntries(): Promise<boolean> {
  if (isLocalLogsEnabled()) {
    try {
      const local = await import("@/server/local-services/engine-logger-local.service");
      return await local.clearPersistentEntries();
    } catch (err) {
      console.warn("[engine-logger] Local clear failed, falling back to Supabase:", err);
    }
  }

  try {
    const { supabaseAdmin } = await import("@/server/supabase/admin");
    const { error } = await supabaseAdmin
      .from("engine_api_call_logs")
      .delete()
      .gte("ts", "1970-01-01T00:00:00.000Z");

    if (error) {
      console.warn("[engine-logger] Falha ao limpar logs persistidos:", error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.warn(
      "[engine-logger] Limpeza persistente indisponível:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

function rowToEntry(row: EngineLogRow): EngineLogEntry {
  return {
    id: row.id,
    ts: new Date(row.ts).getTime(),
    api: row.api,
    op: row.op,
    origin: row.origin,
    mediaType: row.media_type ?? undefined,
    tmdbId: row.tmdb_id ?? undefined,
    endpoint: row.endpoint ?? undefined,
    cacheStatus: row.cache_status,
    durationMs: row.duration_ms,
    success: row.success,
    httpStatus: row.http_status ?? undefined,
    error: row.error ?? undefined,
    fallbackFrom: row.fallback_from ?? undefined,
  };
}

function payloadToStats(
  payload: PersistentStatsPayload | null,
  recentErrors: EngineLogEntry[],
): EngineStats {
  const summary = payload?.summary ?? {};
  const perApi = {} as EngineStats["perApi"];

  for (const name of API_NAMES) {
    perApi[name] = payload?.perApi?.[name] ?? {
      calls: 0,
      hits: 0,
      misses: 0,
      errors: 0,
      avgMs: 0,
      maxMs: 0,
      p95Ms: 0,
      hitRate: 0,
    };
  }

  const startedAt = summary.startedAt ? new Date(summary.startedAt).getTime() : Date.now();

  return {
    startedAt,
    uptimeMs: summary.uptimeMs ?? Math.max(0, Date.now() - startedAt),
    totalCalls: summary.totalCalls ?? 0,
    cacheHitRate: summary.cacheHitRate ?? 0,
    perApi,
    perOrigin: payload?.perOrigin ?? {},
    recentErrors,
  };
}

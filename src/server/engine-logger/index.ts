import { push } from "./store";
import { getOrigin } from "./context";
import { persistEngineLogEntry, getPersistentSnapshot, clearPersistentEntries } from "./persistence";
import type { EngineLogEntry } from "./types";
import { formatDuration, isEnvFlagEnabled, logger } from "@/server/logging/logger";

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

  logEngineSummary(entry);
  void persistEngineLogEntry(entry);
}

function logEngineSummary(entry: EngineLogEntry): void {
  const target = formatEngineScope(entry);
  const scope = target || entry.op;
  const source = `${entry.api}${entry.cacheStatus ? `+cache:${entry.cacheStatus}` : ""}`;
  const duration = formatDuration(entry.durationMs);

  if (!entry.success) {
    const reason = entry.error ?? entry.httpStatus ?? "unknown";
    const nonFatal = isNonFatalAdapterFailure(entry);
    const level = nonFatal ? "WARN" : "ERROR";
    const write = nonFatal ? logger.warn : logger.error;
    write(`[ENGINE:${level}] ${scope} | failed | source=${entry.api} | reason=${reason} | ${duration}`);
    return;
  }

  if (entry.fallbackFrom) {
    logger.warn(
      `[ENGINE:WARN] ${scope} | fallback=${entry.fallbackFrom}->${entry.api} | ${duration}`,
    );
    return;
  }

  if (isEnvFlagEnabled("ENGINE_VERBOSE_LOGS") || entry.cacheStatus === "miss") {
    logger.info(`[ENGINE] ${scope} | source=${source} | ok | ${duration}`);
    return;
  }

  logger.debug(`[ENGINE] ${scope} | source=${source} | ok | ${duration}`);
}

function isNonFatalAdapterFailure(entry: EngineLogEntry): boolean {
  const reason = String(entry.error ?? entry.httpStatus ?? "").toLowerCase();
  if (entry.api !== "balloonerismm") return false;
  // Expected/recoverable failures that must NOT pollute the error channel:
  //   - rate_limited / rate_limited_429: token bucket or HTTP 429 — handled via cooldown + stale cache
  //   - cooldown_active: path already cooling down, request intentionally skipped
  //   - timeout / abort: network-level transient failure
  //   - 404: título não encontrado na fonte (normal para títulos raros ou sem cobertura BR)
  return (
    reason.includes("rate_limited") ||
    reason.includes("cooldown_active") ||
    reason.includes("timeout") ||
    reason.includes("abort") ||
    entry.httpStatus === 404
  );
}

function formatEngineScope(entry: EngineLogEntry): string {
  const endpoint = entry.endpoint?.replace(/^\/+/, "") ?? "";
  const [endpointMediaType, endpointId, ...rest] = endpoint.split("/").filter(Boolean);
  const mediaType = entry.mediaType ?? (endpointMediaType === "movie" || endpointMediaType === "tv" ? endpointMediaType : undefined);
  const id = entry.tmdbId ?? endpointId ?? entry.endpoint;
  const suffix = rest.length > 0 ? `/${rest.join("/")}` : "";

  if (entry.origin && mediaType && id) return `${entry.origin}.${mediaType} ${id}${suffix}`;
  if (entry.origin && id) return `${entry.origin} ${id}${suffix}`;
  if (entry.origin) return entry.origin;
  if (mediaType && id) return `${mediaType} ${id}${suffix}`;
  return entry.op;
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

/**
 * Cliente HTTP Balloonerismm.
 *
 * Camadas de resiliência (em ordem de consulta):
 *   1. Process-level cache  — Map em memória, fresh ou stale
 *   2. In-flight dedup      — mesma chave sendo buscada → aguarda e reusa resultado
 *   3. Cooldown             — por path completo (mediaType+imdbId+endpoint), serve stale
 *   4. Token bucket         — rate-limiter local (max 10 req/s, burst 20)
 *   5. Semáforo global      — limite de concorrência entre requests (BALLOONERISMM_CONCURRENCY)
 *   6. HTTP fetch           — chamada real com retry leve em 5xx
 *
 * Env vars:
 *   BALLOONERISMM_ACTIVE      = "true" | "false"
 *   BALLOONERISMM_BASE_URL    = URL base da API
 *   BALLOONERISMM_API_KEY     = chave de autenticação (opcional)
 *   BALLOONERISMM_TIMEOUT_MS  = timeout por request (default 8000)
 *   BALLOONERISMM_CONCURRENCY = máx chamadas simultâneas cross-request (default 2)
 *   BALLOONERISMM_COOLDOWN_MS = duração do cooldown pós rate-limit (default 60000)
 */

import { logApiCall } from "@/server/engine-logger";
import type { BalloonerismFetchOptions } from "./types";

export const BALLOONERISMM_BASE_URL =
  process.env.BALLOONERISMM_BASE_URL ?? "https://api.balloonerismm.workers.dev";

const DEFAULT_TIMEOUT_MS  = Number(process.env.BALLOONERISMM_TIMEOUT_MS)  || 8_000;
const DEFAULT_TTL_SECONDS = 3_600; // 1h
const STALE_MULTIPLIER    = 3;     // stale window = TTL × 3
const MAX_RETRIES         = 1;
const DEFAULT_COOLDOWN_MS = Number(process.env.BALLOONERISMM_COOLDOWN_MS) || 60_000;

// ─── Process-level cache ──────────────────────────────────────────────────────

type CacheEntry = { data: unknown; expiresAt: number; staleAt: number };
const PROC_CACHE = new Map<string, CacheEntry>();

function procCacheGet<T>(key: string): { data: T; stale: boolean } | null {
  const entry = PROC_CACHE.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (now < entry.expiresAt) return { data: entry.data as T, stale: false };
  if (now < entry.staleAt)   return { data: entry.data as T, stale: true };
  PROC_CACHE.delete(key);
  return null;
}

function procCacheSet(key: string, data: unknown, ttlSeconds: number): void {
  PROC_CACHE.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1_000,
    staleAt:   Date.now() + ttlSeconds * STALE_MULTIPLIER * 1_000,
  });
}

// ─── In-flight deduplication ─────────────────────────────────────────────────
// Previne chamadas HTTP duplicadas simultâneas para o mesmo path+params.
// Requests concorrentes com a mesma chave aguardam o resultado do primeiro e lêem
// do proc cache ao invés de disparar uma segunda chamada HTTP.

const IN_FLIGHT = new Map<string, Promise<void>>();

// ─── Rate-limit cooldown ──────────────────────────────────────────────────────
// Granularidade: por path COMPLETO (ex.: /tv/tt1234567/recommendations).
// Um rate-limit em um IMDb/endpoint NÃO afeta outros shows nem outros endpoints.
// Quando em cooldown, serve stale cache se disponível.

const COOLDOWNS = new Map<string, number>(); // path → expiresAt

function isInCooldown(path: string): boolean {
  const until = COOLDOWNS.get(path);
  if (!until) return false;
  if (Date.now() > until) { COOLDOWNS.delete(path); return false; }
  return true;
}

function enterCooldown(path: string, ms = DEFAULT_COOLDOWN_MS): void {
  COOLDOWNS.set(path, Date.now() + ms);
}

/** Retorna quantos ms restam de cooldown para este path exato (0 = sem cooldown). */
export function getCooldownRemainingMs(path: string): number {
  const until = COOLDOWNS.get(path);
  if (!until || Date.now() > until) return 0;
  return until - Date.now();
}

// ─── Semáforo global de concorrência ─────────────────────────────────────────

const MAX_CONCURRENT = Math.max(1, Number(process.env.BALLOONERISMM_CONCURRENCY ?? 2));
let _active = 0;
const _waiters: Array<() => void> = [];

async function semAcquire(): Promise<void> {
  if (_active < MAX_CONCURRENT) { _active++; return; }
  return new Promise<void>((r) => _waiters.push(r));
}

function semRelease(): void {
  const next = _waiters.shift();
  if (next) next();
  else       _active--;
}

// ─── Token bucket rate limiter ────────────────────────────────────────────────

const RATE_LIMIT  = 10; // req/s
const BURST       = 20;
let _tokens     = BURST;
let _lastRefill = Date.now();

function acquireToken(): boolean {
  const now     = Date.now();
  const elapsed = (now - _lastRefill) / 1_000;
  _tokens     = Math.min(BURST, _tokens + elapsed * RATE_LIMIT);
  _lastRefill = now;
  if (_tokens >= 1) { _tokens -= 1; return true; }
  return false;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isBalloonerismActive(): boolean {
  const flag = process.env.BALLOONERISMM_ACTIVE;
  if (flag === undefined) return false;
  return flag !== "false" && flag !== "0";
}

function getApiKey(): string | undefined {
  return process.env.BALLOONERISMM_API_KEY?.trim();
}

function buildUrl(path: string, params?: Record<string, string | number | boolean>): string {
  const base = BALLOONERISMM_BASE_URL.replace(/\/$/, "");
  const url  = new URL(`${base}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept:         "application/json",
    "User-Agent":   "POPLOG/3.0 (contact: psatheler@gmail.com)",
  };
  const key = getApiKey();
  if (key) headers["X-API-Key"] = key;
  return headers;
}

async function fetchWithRetry(url: string, options: RequestInit, retriesLeft: number): Promise<Response> {
  try {
    const resp = await fetch(url, options);
    if (resp.status >= 500 && resp.status !== 429 && retriesLeft > 0) {
      await new Promise((r) => setTimeout(r, 500));
      return fetchWithRetry(url, options, retriesLeft - 1);
    }
    return resp;
  } catch (err) {
    if (retriesLeft > 0) {
      await new Promise((r) => setTimeout(r, 500));
      return fetchWithRetry(url, options, retriesLeft - 1);
    }
    throw err;
  }
}

/** Extracts mediaType from path for engine-logger metadata (e.g. "/tv/..." → "tv"). */
function pathMediaType(path: string): "movie" | "tv" | undefined {
  const seg = path.split("/").filter(Boolean)[0];
  return seg === "movie" || seg === "tv" ? seg : undefined;
}

// ─── Core fetch (executes after all guards passed) ────────────────────────────

async function doFetch<T>(
  path: string,
  options: BalloonerismFetchOptions,
  cacheKey: string,
  ttl: number,
  staleData: T | null,
): Promise<T | null> {
  await semAcquire();

  const url        = buildUrl(path, options.params);
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const t0         = Date.now();
  const mediaType  = pathMediaType(path);

  try {
    const response = await fetchWithRetry(
      url,
      {
        method:  "GET",
        headers: buildHeaders(),
        cache:   options.cache ?? "default",
        signal:  options.signal ?? controller.signal,
        next:    { revalidate: ttl },
      } as RequestInit & { next?: { revalidate: number } },
      MAX_RETRIES,
    );

    const durationMs = Date.now() - t0;

    if (response.status === 429) {
      const retryAfterSec = Number(response.headers.get("retry-after") ?? 60);
      enterCooldown(path, retryAfterSec * 1_000);
      if (staleData !== null) {
        logApiCall({ api: "balloonerismm", op: "fetch", endpoint: path, mediaType, durationMs, cacheStatus: "stale", success: true, httpStatus: 429, error: "rate_limited_429" });
        return staleData;
      }
      logApiCall({ api: "balloonerismm", op: "fetch", endpoint: path, mediaType, durationMs, cacheStatus: "miss", success: false, httpStatus: 429, error: "rate_limited_429" });
      return null;
    }

    if (!response.ok) {
      logApiCall({ api: "balloonerismm", op: "fetch", endpoint: path, mediaType, durationMs, cacheStatus: "miss", success: false, httpStatus: response.status, error: `HTTP ${response.status}` });
      return null;
    }

    const data = (await response.json()) as T;
    procCacheSet(cacheKey, data, ttl);
    logApiCall({
      api:         "balloonerismm",
      op:          "fetch",
      endpoint:    path,
      mediaType,
      durationMs,
      cacheStatus: response.headers.get("x-cache") === "HIT" ? "hit" : "miss",
      success:     true,
      httpStatus:  response.status,
    });
    return data;

  } catch (err) {
    const durationMs = Date.now() - t0;
    const isAbort    = err instanceof Error && err.name === "AbortError";
    if (!isAbort && staleData !== null) {
      logApiCall({ api: "balloonerismm", op: "fetch", endpoint: path, mediaType, durationMs, cacheStatus: "stale", success: true, error: err instanceof Error ? err.message : String(err) });
      return staleData;
    }
    logApiCall({ api: "balloonerismm", op: "fetch", endpoint: path, mediaType, durationMs, cacheStatus: "miss", success: false, error: isAbort ? "timeout" : err instanceof Error ? err.message : String(err) });
    return null;
  } finally {
    clearTimeout(timeout);
    semRelease();
  }
}

// ─── Cliente principal ────────────────────────────────────────────────────────

/**
 * GET na API Balloonerismm com resiliência em camadas.
 *
 * Ordem de consulta:
 *   1. Process cache (fresh)         → retorna imediatamente
 *   2. In-flight dedup               → aguarda request idêntica em curso, reusa proc cache
 *   3. Cooldown ativo (path exato)   → retorna stale ou null, nunca HTTP
 *   4. Token bucket esgotado         → entra cooldown, retorna stale ou null
 *   5. Semáforo + HTTP               → chama API, salva em proc cache
 *
 * Nunca lança — erros são absorvidos. Retorna null em caso de falha total.
 * O cooldown é por path completo: /tv/tt1234567/recommendations não afeta /tv/tt9999/similar.
 */
export async function balloonerismGet<T>(
  path: string,
  options: BalloonerismFetchOptions = {},
): Promise<T | null> {
  if (!isBalloonerismActive()) return null;

  const ttl      = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const cacheKey = `balloon:${path}:${JSON.stringify(options.params ?? {})}`;
  const mediaType = pathMediaType(path);

  // 1. Process cache fresh
  const cached = procCacheGet<T>(cacheKey);
  if (cached && !cached.stale) {
    logApiCall({ api: "balloonerismm", op: "fetch", endpoint: path, mediaType, durationMs: 0, cacheStatus: "hit", success: true });
    return cached.data;
  }

  // 2. In-flight dedup: se mesma chave está sendo buscada, aguarda e lê do cache
  const existing = IN_FLIGHT.get(cacheKey);
  if (existing) {
    await existing.catch(() => undefined);
    const fresh = procCacheGet<T>(cacheKey);
    if (fresh) {
      logApiCall({ api: "balloonerismm", op: "fetch", endpoint: path, mediaType, durationMs: 0, cacheStatus: "hit", success: true });
      return fresh.data;
    }
    // In-flight falhou — serve stale se disponível
    if (cached) {
      logApiCall({ api: "balloonerismm", op: "fetch", endpoint: path, mediaType, durationMs: 0, cacheStatus: "stale", success: true, error: "in_flight_failed" });
      return cached.data;
    }
    return null;
  }

  // 3. Cooldown ativo → stale ou null (sem HTTP)
  if (isInCooldown(path)) {
    const remaining = getCooldownRemainingMs(path);
    if (cached) {
      logApiCall({ api: "balloonerismm", op: "fetch", endpoint: path, mediaType, durationMs: 0, cacheStatus: "stale", success: true, error: `cooldown_active:${remaining}ms` });
      return cached.data;
    }
    logApiCall({ api: "balloonerismm", op: "fetch", endpoint: path, mediaType, durationMs: 0, cacheStatus: "miss", success: false, error: `cooldown_active:${remaining}ms` });
    return null;
  }

  // 4. Token bucket esgotado → cooldown + stale ou null
  if (!acquireToken()) {
    enterCooldown(path);
    if (cached) {
      logApiCall({ api: "balloonerismm", op: "fetch", endpoint: path, mediaType, durationMs: 0, cacheStatus: "stale", success: true, error: "rate_limited" });
      return cached.data;
    }
    logApiCall({ api: "balloonerismm", op: "fetch", endpoint: path, mediaType, durationMs: 0, cacheStatus: "miss", success: false, error: "rate_limited" });
    return null;
  }

  // 5. HTTP fetch (via semáforo), resultado armazenado em proc cache
  let resolve!: () => void;
  const signal = new Promise<void>((r) => { resolve = r; });
  IN_FLIGHT.set(cacheKey, signal);

  try {
    const staleData = cached ? cached.data : null;
    const result = await doFetch<T>(path, options, cacheKey, ttl, staleData);
    return result;
  } finally {
    IN_FLIGHT.delete(cacheKey);
    resolve();
  }
}

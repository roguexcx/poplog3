/**
 * Cliente HTTP centralizado para Trakt.tv v2.
 *
 * Dados públicos usam Client-ID, sem OAuth. Escritas exigem token válido e
 * respeitam o limite documentado de 1 chamada por segundo.
 */

import { logApiCall } from "@/server/engine-logger";
import type { TraktFetchOptions, TraktRequestOptions } from "./types";

export const TRAKT_BASE_URL = "https://api.trakt.tv";

export const TRAKT_USER_AGENT = "POPLOG/1.0.0";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_TTL_SECONDS = 86_400;
const DEFAULT_STALE_TTL_SECONDS = 604_800;
const MIN_WRITE_INTERVAL_MS = 1_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const CONTROLLED_HTTP_STATUSES = new Set([401, 403, 404, 410, 412, 422, 429, 500, 502, 503, 504, 520, 521, 522]);

type TraktMethod = NonNullable<TraktRequestOptions["method"]>;
type CacheEntry = {
  data: unknown;
  expiresAt: number;
  staleUntil: number;
  status: number;
};
type CooldownEntry = {
  until: number;
  retryAfterSeconds: number | null;
  rateLimit: string | null;
  status: number;
};
type TraktFailureReason =
  | "inactive"
  | "missing_client_id"
  | "rate_limited"
  | "write_requires_oauth"
  | "write_rate_limited"
  | "not_found"
  | "http_error"
  | "timeout"
  | "network_error";

export class TraktControlledError extends Error {
  readonly reason: TraktFailureReason;
  readonly status?: number;
  readonly retryAfterSeconds?: number | null;
  readonly rateLimit?: string | null;
  readonly cacheStatus?: "hit" | "miss" | "stale" | "skipped";
  readonly logged: boolean;

  constructor(
    reason: TraktFailureReason,
    message: string,
    details: {
      status?: number;
      retryAfterSeconds?: number | null;
      rateLimit?: string | null;
      cacheStatus?: "hit" | "miss" | "stale" | "skipped";
      logged?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "TraktControlledError";
    this.reason = reason;
    this.status = details.status;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.rateLimit = details.rateLimit;
    this.cacheStatus = details.cacheStatus;
    this.logged = details.logged ?? false;
  }
}

const memoryCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const cooldowns = new Map<string, CooldownEntry>();
let lastWriteAt = 0;
let warnedMissingClientId = false;

export function isTraktActive(): boolean {
  const flag = process.env.TRAKT_ACTIVE;
  if (flag === undefined) return false;
  return flag !== "false" && flag !== "0";
}

export function hasTraktClientId(): boolean {
  return Boolean(process.env.TRAKT_CLIENT_ID?.trim());
}

export function getTraktClientStatus() {
  const now = Date.now();
  const activeCooldowns = [...cooldowns.entries()]
    .filter(([, entry]) => entry.until > now)
    .map(([endpoint, entry]) => ({
      endpoint,
      until: new Date(entry.until).toISOString(),
      retryAfterSeconds: entry.retryAfterSeconds,
      rateLimit: entry.rateLimit,
      status: entry.status,
    }));

  return {
    active: isTraktActive(),
    hasClientId: hasTraktClientId(),
    baseUrl: TRAKT_BASE_URL,
    userAgent: TRAKT_USER_AGENT,
    apiVersion: "2",
    cacheEntries: memoryCache.size,
    inflight: inflight.size,
    cooldowns: activeCooldowns,
  };
}

export function clearTraktClientRuntimeState(): void {
  memoryCache.clear();
  inflight.clear();
  cooldowns.clear();
  lastWriteAt = 0;
  warnedMissingClientId = false;
}

export function buildTraktHeaders(accessToken?: string | null): Record<string, string> {
  const clientId = process.env.TRAKT_CLIENT_ID?.trim();
  if (!clientId) {
    throw new TraktControlledError(
      "missing_client_id",
      "TRAKT_CLIENT_ID não configurado.",
      { cacheStatus: "skipped" },
    );
  }

  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": TRAKT_USER_AGENT,
    "trakt-api-key": clientId,
    "trakt-api-version": "2",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function buildUrl(path: string, params?: Record<string, string | number | boolean>): string {
  const base = TRAKT_BASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function cacheKey(method: TraktMethod, path: string, params?: Record<string, string | number | boolean>): string {
  return `${method} ${buildUrl(path, params)}`;
}

function endpointKey(path: string): string {
  return path.split("?")[0] || path;
}

function readFreshCache<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.data as T;
}

function readStaleCache<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry || entry.staleUntil <= Date.now()) return null;
  return entry.data as T;
}

function setCache(key: string, data: unknown, status: number, ttlSeconds: number, staleTtlSeconds: number): void {
  const now = Date.now();
  memoryCache.set(key, {
    data,
    status,
    expiresAt: now + ttlSeconds * 1_000,
    staleUntil: now + Math.max(ttlSeconds, staleTtlSeconds) * 1_000,
  });
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, Math.ceil((dateMs - Date.now()) / 1_000));
  }

  return null;
}

function getCooldown(path: string): CooldownEntry | null {
  const now = Date.now();
  const endpoint = cooldowns.get(endpointKey(path));
  const global = cooldowns.get("*");
  const active = [endpoint, global]
    .filter((entry): entry is CooldownEntry => entry !== undefined && entry.until > now)
    .sort((a, b) => b.until - a.until)[0];
  return active ?? null;
}

function setCooldown(path: string, response: Response): CooldownEntry {
  const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));
  const rateLimit = response.headers.get("X-Ratelimit");
  const remaining = response.headers.get("X-Ratelimit-Remaining");
  const reset = response.headers.get("X-Ratelimit-Reset");
  const resetSeconds = reset && /^\d+$/.test(reset)
    ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1_000))
    : null;
  const durationMs = Math.max(
    retryAfterSeconds != null
      ? retryAfterSeconds * 1_000
      : resetSeconds != null && remaining === "0"
        ? resetSeconds * 1_000
        : DEFAULT_RATE_LIMIT_COOLDOWN_MS,
    1_000,
  );
  const entry = {
    until: Date.now() + durationMs,
    retryAfterSeconds,
    rateLimit,
    status: response.status,
  };
  cooldowns.set(endpointKey(path), entry);
  return entry;
}

function logTraktLine(
  method: TraktMethod,
  path: string,
  outcome: string,
  status: number | "skip",
  extras: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const suffix = Object.entries(extras)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.log(`[trakt] ${method} ${path} ${outcome} ${status}${suffix ? ` ${suffix}` : ""}`);
}

function logFailure(path: string, durationMs: number, status: number | undefined, error: string, cacheStatus: "miss" | "skipped" | "stale"): void {
  logApiCall({
    api: "trakt",
    op: "fetch",
    endpoint: path,
    durationMs,
    cacheStatus,
    success: false,
    httpStatus: status,
    error,
  });
}

async function waitForWriteSlot(): Promise<void> {
  const elapsed = Date.now() - lastWriteAt;
  if (elapsed < MIN_WRITE_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_WRITE_INTERVAL_MS - elapsed));
  }
  lastWriteAt = Date.now();
}

async function requestTrakt<T>(
  path: string,
  options: TraktRequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";

  if (!isTraktActive()) {
    logTraktLine(method, path, "skipped", "skip", { reason: "inactive" });
    throw new TraktControlledError("inactive", "Trakt está inativo.", { cacheStatus: "skipped" });
  }

  if (!hasTraktClientId()) {
    if (!warnedMissingClientId) {
      console.warn("[trakt] skipped all reason=missing_client_id");
      warnedMissingClientId = true;
    }
    logTraktLine(method, path, "skipped", "skip", { reason: "missing_client_id" });
    throw new TraktControlledError("missing_client_id", "TRAKT_CLIENT_ID não configurado.", {
      cacheStatus: "skipped",
    });
  }

  if (method !== "GET" && !options.accessToken) {
    logTraktLine(method, path, "blocked", "skip", { reason: "write_requires_oauth" });
    throw new TraktControlledError(
      "write_requires_oauth",
      "Métodos POST/PUT/DELETE do Trakt exigem OAuth válido.",
      { cacheStatus: "skipped" },
    );
  }

  const key = cacheKey(method, path, options.params);
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const staleTtl = options.staleTtlSeconds ?? DEFAULT_STALE_TTL_SECONDS;

  if (method === "GET") {
    const cached = readFreshCache<T>(key);
    if (cached != null) {
      logTraktLine(method, path, "ok", 200, { cache: "hit" });
      return cached;
    }

    const cooldown = getCooldown(path);
    if (cooldown) {
      const stale = readStaleCache<T>(key);
      logTraktLine(method, path, "limited", 429, {
        retryAfter: cooldown.retryAfterSeconds,
        rateLimit: cooldown.rateLimit,
        cooldown: "active",
        cache: stale ? "stale" : "miss",
      });
      if (stale != null) return stale;
      throw new TraktControlledError("rate_limited", "Trakt em cooldown.", {
        status: 429,
        retryAfterSeconds: cooldown.retryAfterSeconds,
        rateLimit: cooldown.rateLimit,
        cacheStatus: "miss",
      });
    }

    const pending = inflight.get(key);
    if (pending) {
      logTraktLine(method, path, "deduped", 200, { cache: "inflight" });
      return pending as Promise<T>;
    }
  }

  const requestPromise = performTraktRequest<T>(path, {
    ...options,
    method,
    ttlSeconds: ttl,
    staleTtlSeconds: staleTtl,
  });

  if (method === "GET") inflight.set(key, requestPromise);

  try {
    return await requestPromise;
  } finally {
    if (method === "GET") inflight.delete(key);
  }
}

async function performTraktRequest<T>(
  path: string,
  options: TraktRequestOptions & { method: TraktMethod; ttlSeconds: number; staleTtlSeconds: number },
): Promise<T> {
  const method = options.method;
  const startedAt = Date.now();
  const key = cacheKey(method, path, options.params);
  const url = buildUrl(path, options.params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  if (method !== "GET") await waitForWriteSlot();

  try {
    const response = await fetch(url, {
      method,
      headers: buildTraktHeaders(options.accessToken),
      cache: method === "GET" ? options.cache ?? "default" : "no-store",
      signal: options.signal ?? controller.signal,
      body: options.body == null ? undefined : JSON.stringify(options.body),
      ...(method === "GET" ? { next: { revalidate: options.ttlSeconds } } : {}),
    } as RequestInit & { next?: { revalidate: number } });

    const durationMs = Date.now() - startedAt;
    const remaining = response.headers.get("X-Ratelimit-Remaining") ?? undefined;

    if (response.status === 429) {
      const cooldown = setCooldown(path, response);
      const stale = method === "GET" ? readStaleCache<T>(key) : null;
      logTraktLine(method, path, "limited", 429, {
        retryAfter: cooldown.retryAfterSeconds,
        rateLimit: cooldown.rateLimit,
        remaining,
        cooldown: "active",
        cache: stale ? "stale" : "miss",
      });
      logFailure(path, durationMs, 429, "rate_limited", stale ? "stale" : "miss");
      if (stale != null) return stale;
      throw new TraktControlledError("rate_limited", "Trakt retornou HTTP 429.", {
        status: 429,
        retryAfterSeconds: cooldown.retryAfterSeconds,
        rateLimit: cooldown.rateLimit,
        cacheStatus: "miss",
        logged: true,
      });
    }

    if (response.status === 404) {
      logTraktLine(method, path, "not_found", 404, { cache: "miss", remaining });
      logApiCall({
        api: "trakt",
        op: "fetch",
        endpoint: path,
        durationMs,
        cacheStatus: "skipped",
        success: true,
        httpStatus: 404,
        error: "not_found",
      });
      throw new TraktControlledError("not_found", "Recurso Trakt não encontrado.", {
        status: 404,
        cacheStatus: "skipped",
        logged: true,
      });
    }

    if (!response.ok) {
      if (CONTROLLED_HTTP_STATUSES.has(response.status)) {
        const retryable = response.status === 429 || response.status >= 500;
        const cooldown = retryable ? setCooldown(path, response) : null;
        const stale = method === "GET" ? readStaleCache<T>(key) : null;
        logTraktLine(method, path, "controlled_error", response.status, {
          cache: stale ? "stale" : "miss",
          remaining,
          retryAfter: cooldown?.retryAfterSeconds,
          rateLimit: cooldown?.rateLimit,
        });
        logFailure(path, durationMs, response.status, `HTTP ${response.status}`, stale ? "stale" : "miss");
        if (stale != null) return stale;
        throw new TraktControlledError("http_error", `Trakt retornou HTTP ${response.status}.`, {
          status: response.status,
          retryAfterSeconds: cooldown?.retryAfterSeconds ?? null,
          rateLimit: cooldown?.rateLimit ?? null,
          cacheStatus: "miss",
          logged: true,
        });
      }

      const stale = method === "GET" ? readStaleCache<T>(key) : null;
      logTraktLine(method, path, "failed", response.status, {
        cache: stale ? "stale" : "miss",
        remaining,
      });
      logFailure(path, durationMs, response.status, `HTTP ${response.status}`, stale ? "stale" : "miss");
      if (stale != null) return stale;
      throw new TraktControlledError("http_error", `Trakt retornou HTTP ${response.status}.`, {
        status: response.status,
        cacheStatus: "miss",
        logged: true,
      });
    }

    const data = (response.status === 204 ? null : await response.json()) as T;
    if (method === "GET") {
      setCache(key, data, response.status, options.ttlSeconds, options.staleTtlSeconds);
    }

    logTraktLine(method, path, "ok", response.status, {
      cache: method === "GET" ? "miss" : "none",
      remaining,
    });
    logApiCall({
      api: "trakt",
      op: "fetch",
      endpoint: path,
      durationMs,
      cacheStatus: method === "GET" ? "miss" : "skipped",
      success: true,
      httpStatus: response.status,
    });
    return data;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (error instanceof TraktControlledError) throw error;

    const stale = method === "GET" ? readStaleCache<T>(key) : null;
    const isAbort = error instanceof Error && error.name === "AbortError";
    const reason = isAbort ? "timeout" : "network_error";
    logTraktLine(method, path, "failed", "skip", {
      reason,
      cache: stale ? "stale" : "miss",
    });
    logFailure(path, durationMs, undefined, isAbort ? "timeout" : error instanceof Error ? error.message : String(error), stale ? "stale" : "miss");
    if (stale != null) return stale;
    throw new TraktControlledError(reason, isAbort ? "Timeout no Trakt." : "Falha de rede no Trakt.", {
      cacheStatus: "miss",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function traktFetch<T>(
  path: string,
  options: TraktRequestOptions = {},
): Promise<T | null> {
  try {
    return await requestTrakt<T>(path, options);
  } catch (error) {
    if (error instanceof TraktControlledError) {
      if (!error.logged) {
        logFailure(
          path,
          0,
          error.status,
          error.reason,
          error.cacheStatus === "skipped" ? "skipped" : "miss",
        );
      }
      return null;
    }

    logFailure(path, 0, undefined, error instanceof Error ? error.message : String(error), "miss");
    return null;
  }
}

export async function traktGet<T>(
  path: string,
  options: TraktFetchOptions = {},
): Promise<T | null> {
  return traktFetch<T>(path, { ...options, method: "GET" });
}

/**
 * Cliente HTTP TheTVDB v4.
 *
 * TheTVDB usa JWT: obtido via POST /login, válido 30 dias.
 * Token é guardado em memória e renovado automaticamente quando expirado.
 *
 * Rate limiting:
 *   - 250 req/mês no plano gratuito (monitorar!)
 *   - Backoff exponencial em 429
 *
 * Ativar via TVDB_ACTIVE=true + TVDB_API_KEY=<key>
 */

import { logApiCall } from "@/server/engine-logger";
import type { TvdbLoginResponse, TvdbFetchOptions, TvdbLinks } from "./types";

export const TVDB_BASE_URL =
  process.env.TVDB_API_BASE_URL ?? "https://api4.thetvdb.com/v4";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TTL_SECONDS = 86_400; // 1 dia
const TOKEN_TTL_MS = 28 * 24 * 60 * 60 * 1_000; // 28 dias (margem de segurança)

// ─── Token cache em memória ───────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;
let tokenRefreshInProgress: Promise<string | null> | null = null;

export function isTvdbActive(): boolean {
  const flag = process.env.TVDB_ACTIVE;
  if (flag === undefined) return false;
  return flag !== "false" && flag !== "0";
}

function getApiKey(): string {
  const key = process.env.TVDB_API_KEY?.trim();
  if (!key) throw new Error("[tvdb-client] TVDB_API_KEY não configurado.");
  return key;
}

// ─── Auth / JWT ───────────────────────────────────────────────────────────────

async function fetchNewToken(): Promise<string | null> {
  try {
    const apiKey = getApiKey();
    const response = await fetch(`${TVDB_BASE_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: apiKey }),
    });
    if (!response.ok) {
      console.error("[tvdb-client] Falha no login:", response.status);
      return null;
    }
    const data = (await response.json()) as TvdbLoginResponse;
    return data.data?.token ?? null;
  } catch (err) {
    console.error("[tvdb-client] Erro ao obter token:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function getToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

  // Evita múltiplas chamadas simultâneas de refresh
  if (tokenRefreshInProgress) return tokenRefreshInProgress;

  tokenRefreshInProgress = fetchNewToken().then((token) => {
    tokenRefreshInProgress = null;
    if (token) {
      cachedToken = token;
      tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
    }
    return token;
  });

  return tokenRefreshInProgress;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildUrl(path: string, params?: Record<string, string | number | boolean>): string {
  const base = TVDB_BASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "POPLOG/3.0 (contact: psatheler@gmail.com)",
  };
}

// ─── Fetch com retry e backoff ─────────────────────────────────────────────────

async function fetchWithBackoff(
  url: string,
  options: RequestInit,
  retriesLeft: number,
  delayMs: number,
): Promise<Response> {
  const response = await fetch(url, options);
  if (response.status === 429 && retriesLeft > 0) {
    // Respeita Retry-After se presente
    const retryAfter = response.headers.get("Retry-After");
    const waitMs = retryAfter ? Number(retryAfter) * 1_000 : delayMs;
    await new Promise((r) => setTimeout(r, waitMs));
    return fetchWithBackoff(url, options, retriesLeft - 1, delayMs * 2);
  }
  return response;
}

// ─── Cliente principal ────────────────────────────────────────────────────────

/**
 * Executa GET na API TheTVDB v4.
 * Retorna null se a fonte estiver inativa, sem token ou em erro.
 */
export async function tvdbGet<T>(
  path: string,
  options: TvdbFetchOptions = {},
): Promise<T | null> {
  if (!isTvdbActive()) return null;

  const token = await getToken();
  if (!token) {
    console.warn("[tvdb-client] Token indisponível — skipping");
    return null;
  }

  const url = buildUrl(path, options.params);
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const t0 = Date.now();
  try {
    const response = await fetchWithBackoff(
      url,
      {
        method: "GET",
        headers: buildHeaders(token),
        cache: options.cache ?? "default",
        signal: options.signal ?? controller.signal,
        next: { revalidate: ttl },
      } as RequestInit & { next?: { revalidate: number } },
      2,    // máx 2 retentativas em 429
      1_000, // backoff inicial de 1s
    );

    const durationMs = Date.now() - t0;

    if (!response.ok) {
      logApiCall({
        api: "tvdb",
        op: "fetch",
        endpoint: path,
        durationMs,
        cacheStatus: "miss",
        success: false,
        httpStatus: response.status,
        error: `HTTP ${response.status}`,
      });
      return null;
    }

    const envelope = (await response.json()) as { status: string; data: T };
    logApiCall({
      api: "tvdb",
      op: "fetch",
      endpoint: path,
      durationMs,
      cacheStatus: response.headers.get("x-cache") === "HIT" ? "hit" : "miss",
      success: true,
      httpStatus: response.status,
    });
    return envelope.data ?? null;
  } catch (err) {
    const durationMs = Date.now() - t0;
    const isAbort = err instanceof Error && err.name === "AbortError";
    logApiCall({
      api: "tvdb",
      op: "fetch",
      endpoint: path,
      durationMs,
      cacheStatus: "miss",
      success: false,
      error: isAbort ? "timeout" : err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Like tvdbGet, but also returns the `links` pagination object from the TVDB envelope.
 * Use this when you need to paginate through multi-page results (e.g. episode lists).
 *
 * Returns `{ data: null, links: null }` when TVDB is inactive or the request fails.
 */
export async function tvdbGetWithLinks<T>(
  path: string,
  options: TvdbFetchOptions = {},
): Promise<{ data: T | null; links: TvdbLinks | null }> {
  if (!isTvdbActive()) return { data: null, links: null };

  const token = await getToken();
  if (!token) {
    console.warn("[tvdb-client] Token indisponível — skipping");
    return { data: null, links: null };
  }

  const url = buildUrl(path, options.params);
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const t0 = Date.now();
  try {
    const response = await fetchWithBackoff(
      url,
      {
        method: "GET",
        headers: buildHeaders(token),
        cache: options.cache ?? "default",
        signal: options.signal ?? controller.signal,
        next: { revalidate: ttl },
      } as RequestInit & { next?: { revalidate: number } },
      2,
      1_000,
    );

    const durationMs = Date.now() - t0;

    if (!response.ok) {
      logApiCall({
        api: "tvdb",
        op: "fetch",
        endpoint: path,
        durationMs,
        cacheStatus: "miss",
        success: false,
        httpStatus: response.status,
        error: `HTTP ${response.status}`,
      });
      return { data: null, links: null };
    }

    const envelope = (await response.json()) as { status: string; data: T; links?: TvdbLinks };
    logApiCall({
      api: "tvdb",
      op: "fetch",
      endpoint: path,
      durationMs,
      cacheStatus: response.headers.get("x-cache") === "HIT" ? "hit" : "miss",
      success: true,
      httpStatus: response.status,
    });
    return { data: envelope.data ?? null, links: envelope.links ?? null };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const isAbort = err instanceof Error && err.name === "AbortError";
    logApiCall({
      api: "tvdb",
      op: "fetch",
      endpoint: path,
      durationMs,
      cacheStatus: "miss",
      success: false,
      error: isAbort ? "timeout" : err instanceof Error ? err.message : String(err),
    });
    return { data: null, links: null };
  } finally {
    clearTimeout(timeout);
  }
}

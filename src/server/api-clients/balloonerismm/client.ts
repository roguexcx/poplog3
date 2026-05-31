/**
 * Cliente HTTP Balloonerismm.
 *
 * Balloonerismm é uma API IMDb-first não oficial.
 * Políticas obrigatórias por design:
 *   - Rate limiting (máx 10 req/s, burst de 20)
 *   - Timeout de 8s por request
 *   - Retry leve: 1 retentativa em erro 5xx/rede
 *   - Cache obrigatório: nunca chama sem TTL definido
 *   - Não deve ser usada como primeira fonte global
 *
 * Ativar via BALLOONERISMM_ACTIVE=true + BALLOONERISMM_BASE_URL=<url>
 */

import { logApiCall } from "@/server/engine-logger";
import type { BalloonerismFetchOptions } from "./types";

export const BALLOONERISMM_BASE_URL =
  process.env.BALLOONERISMM_BASE_URL ?? "https://api.balloonerismm.com/v1";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_TTL_SECONDS = 3_600; // 1h
const MAX_RETRIES = 1;

// ─── Rate limiter em memória ──────────────────────────────────────────────────

const RATE_LIMIT = 10; // req/s
const BURST = 20;
let tokens = BURST;
let lastRefill = Date.now();

function acquireToken(): boolean {
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1_000;
  tokens = Math.min(BURST, tokens + elapsed * RATE_LIMIT);
  lastRefill = now;
  if (tokens >= 1) {
    tokens -= 1;
    return true;
  }
  return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const url = new URL(`${base}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "POPLOG/3.0 (contact: psatheler@gmail.com)",
  };
  const apiKey = getApiKey();
  if (apiKey) headers["X-API-Key"] = apiKey;
  return headers;
}

// ─── Fetch com retry ──────────────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retriesLeft: number,
): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if (response.status >= 500 && retriesLeft > 0) {
      await new Promise((r) => setTimeout(r, 500));
      return fetchWithRetry(url, options, retriesLeft - 1);
    }
    return response;
  } catch (err) {
    if (retriesLeft > 0) {
      await new Promise((r) => setTimeout(r, 500));
      return fetchWithRetry(url, options, retriesLeft - 1);
    }
    throw err;
  }
}

// ─── Cliente principal ────────────────────────────────────────────────────────

/**
 * Executa GET na API Balloonerismm.
 * Retorna null se a fonte estiver inativa, rate-limitada ou em erro.
 * Nunca lança — erros são logados e absorvidos.
 */
export async function balloonerismGet<T>(
  path: string,
  options: BalloonerismFetchOptions = {},
): Promise<T | null> {
  if (!isBalloonerismActive()) return null;

  if (!acquireToken()) {
    logApiCall({
      api: "balloonerismm",
      op: "fetch",
      endpoint: path,
      durationMs: 0,
      cacheStatus: "miss",
      success: false,
      error: "rate_limited",
    });
    return null;
  }

  const url = buildUrl(path, options.params);
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const t0 = Date.now();
  try {
    const response = await fetchWithRetry(
      url,
      {
        method: "GET",
        headers: buildHeaders(),
        cache: options.cache ?? "default",
        signal: options.signal ?? controller.signal,
        next: { revalidate: ttl },
      } as RequestInit & { next?: { revalidate: number } },
      MAX_RETRIES,
    );

    const durationMs = Date.now() - t0;

    if (!response.ok) {
      logApiCall({
        api: "balloonerismm",
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

    const data = (await response.json()) as T;
    logApiCall({
      api: "balloonerismm",
      op: "fetch",
      endpoint: path,
      durationMs,
      cacheStatus: response.headers.get("x-cache") === "HIT" ? "hit" : "miss",
      success: true,
      httpStatus: response.status,
    });
    return data;
  } catch (err) {
    const durationMs = Date.now() - t0;
    const isAbort = err instanceof Error && err.name === "AbortError";
    logApiCall({
      api: "balloonerismm",
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

/**
 * Cliente HTTP Trakt.tv v2.
 *
 * Trakt usa Client-ID (sem auth) para dados públicos (trending, shows, episódios).
 * Rate limit: 1.000 req/5min por IP no plano gratuito.
 *
 * Ativar via TRAKT_ACTIVE=true + TRAKT_CLIENT_ID=<id>
 */

import { logApiCall } from "@/server/engine-logger";
import type { TraktFetchOptions } from "./types";

export const TRAKT_BASE_URL =
  process.env.TRAKT_API_BASE_URL ?? "https://api.trakt.tv";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_TTL_SECONDS = 86_400; // 1 dia

export function isTraktActive(): boolean {
  const flag = process.env.TRAKT_ACTIVE;
  if (flag === undefined) return false;
  return flag !== "false" && flag !== "0";
}

function getClientId(): string {
  const id = process.env.TRAKT_CLIENT_ID?.trim();
  if (!id) throw new Error("[trakt-client] TRAKT_CLIENT_ID não configurado.");
  return id;
}

function buildUrl(path: string, params?: Record<string, string | number | boolean>): string {
  const base = TRAKT_BASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": getClientId(),
    "User-Agent": "POPLOG/3.0 (contact: psatheler@gmail.com)",
  };
}

/**
 * Executa GET na API Trakt.tv v2.
 * Retorna null se inativo, sem Client-ID ou em erro.
 * Nunca lança — erros são logados e absorvidos.
 */
export async function traktGet<T>(
  path: string,
  options: TraktFetchOptions = {},
): Promise<T | null> {
  if (!isTraktActive()) return null;

  // Validate key exists before building headers
  try {
    getClientId();
  } catch {
    return null;
  }

  const url = buildUrl(path, options.params);
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const t0 = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(),
      cache: options.cache ?? "default",
      signal: options.signal ?? controller.signal,
      next: { revalidate: ttl },
    } as RequestInit & { next?: { revalidate: number } });

    const durationMs = Date.now() - t0;

    if (response.status === 404) {
      logApiCall({
        api: "trakt",
        op: "fetch",
        endpoint: path,
        durationMs,
        cacheStatus: "skipped",
        success: true,
        httpStatus: response.status,
        error: "not_found",
      });
      return null;
    }

    if (!response.ok) {
      logApiCall({
        api: "trakt",
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
      api: "trakt",
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
      api: "trakt",
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

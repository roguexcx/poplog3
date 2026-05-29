import { logApiCall } from "@/server/engine-logger";
import type { TmdbCollectionDetails } from "./types";

export const TMDB_BASE_URL = "https://api.themoviedb.org/3";

export type TmdbFetchOptions = {
  params?: Record<string, string | number | boolean | undefined>;
  revalidate?: number;
  cache?: RequestCache;
  signal?: AbortSignal;
};

export function getTmdbToken(): string {
  const token = process.env.TMDB_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("TMDB_ACCESS_TOKEN não configurado.");
  return token;
}

export function buildTmdbHeaders(token?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token ?? getTmdbToken()}`,
    Accept: "application/json",
  };
}

export function buildTmdbUrl(
  path: string,
  params: TmdbFetchOptions["params"] = {},
): string {
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  url.searchParams.set("language", "pt-BR");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function tmdbFetch<T>(
  path: string,
  options: TmdbFetchOptions = {},
): Promise<T> {
  const token = getTmdbToken();
  const t0 = Date.now();

  const fetchOptions: RequestInit = {
    headers: buildTmdbHeaders(token),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.cache
      ? { cache: options.cache }
      : { next: { revalidate: options.revalidate ?? 3600 } }),
  };

  const response = await fetch(buildTmdbUrl(path, options.params), fetchOptions);
  const durationMs = Date.now() - t0;

  if (!response.ok) {
    let errorBody: string | null = null;
    try {
      const body = await response.json();
      errorBody = JSON.stringify(body);
    } catch {
      errorBody = await response.text();
    }

    const errorMsg = `TMDB request failed: ${response.status}`;
    console.error("[tmdbFetch] erro na requisição TMDB", {
      path,
      status: response.status,
      statusText: response.statusText,
      errorBody,
      url: buildTmdbUrl(path, options.params),
    });

    logApiCall({
      api: "tmdb",
      op: "fetch",
      endpoint: path,
      cacheStatus: "none",
      durationMs,
      success: false,
      httpStatus: response.status,
      error: errorMsg,
    });
    throw new Error(errorMsg);
  }

  logApiCall({
    api: "tmdb",
    op: "fetch",
    endpoint: path,
    cacheStatus: "none",
    durationMs,
    success: true,
    httpStatus: response.status,
  });

  return response.json() as Promise<T>;
}

/**
 * Variante segura: retorna null em vez de lançar exceção em caso de erro.
 * Use para chamadas não críticas onde a ausência de dados é aceitável.
 */
export async function tmdbFetchSafe<T>(
  path: string,
  options: TmdbFetchOptions = {},
): Promise<T | null> {
  try {
    return await tmdbFetch<T>(path, options);
  } catch {
    return null;
  }
}

export async function fetchTmdbCollection(
  id: number,
): Promise<TmdbCollectionDetails | null> {
  return tmdbFetchSafe<TmdbCollectionDetails>(`/collection/${id}`, {
    revalidate: 86400,
  });
}

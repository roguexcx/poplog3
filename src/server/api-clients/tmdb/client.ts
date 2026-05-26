import { logApiCall } from "@/server/engine-logger";
import type { TmdbCollectionDetails } from "./types";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

type TmdbFetchOptions = {
  params?: Record<string, string | number | boolean | undefined>;
  revalidate?: number;
};

function buildTmdbUrl(path: string, params: TmdbFetchOptions["params"] = {}) {
  const url = new URL(`${TMDB_BASE_URL}${path}`);

  url.searchParams.set("language", "pt-BR");

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export async function tmdbFetch<T>(
  path: string,
  options: TmdbFetchOptions = {}
): Promise<T> {
  const token = process.env.TMDB_ACCESS_TOKEN?.trim();

  if (!token) {
    throw new Error("TMDB_ACCESS_TOKEN não configurado.");
  }

  const t0 = Date.now();

  const response = await fetch(buildTmdbUrl(path, options.params), {
    headers: {
      Authorization: `Bearer ${token}`,
      accept: "application/json",
    },
    next: {
      revalidate: options.revalidate ?? 3600,
    },
  });

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

export async function fetchTmdbCollection(
  id: number
): Promise<TmdbCollectionDetails | null> {
  try {
    return await tmdbFetch<TmdbCollectionDetails>(`/collection/${id}`, {
      revalidate: 86400,
    });
  } catch {
    return null;
  }
}
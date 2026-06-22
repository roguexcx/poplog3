import { logApiCall } from "@/server/engine-logger";

const OMDB_BASE_URL = "https://www.omdbapi.com/";

type OmdbFetchParams = {
  imdbId?: string;
  title?: string;
};

function buildOmdbUrl(params: OmdbFetchParams) {
  const url = new URL(OMDB_BASE_URL);

  const apiKey = process.env.OMDB_API_KEY;

  if (!apiKey) {
    throw new Error("OMDB_API_KEY não configurada.");
  }

  url.searchParams.set("apikey", apiKey);

  if (params.imdbId) {
    url.searchParams.set("i", params.imdbId);
  }

  if (params.title) {
    url.searchParams.set("t", params.title);
  }

  return url.toString();
}

export async function omdbFetch<T>(params: OmdbFetchParams): Promise<T> {
  const t0 = Date.now();

  const response = await fetch(buildOmdbUrl(params), {
    next: {
      revalidate: 60 * 60 * 24 * 30,
    },
  });

  const durationMs = Date.now() - t0;

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json() as { Error?: string };
      if (body?.Error) detail = `: ${body.Error}`;
    } catch {}
    const error = `OMDb request failed: ${response.status}${detail}`;
    logApiCall({
      api: "omdb",
      op: "fetch",
      endpoint: params.imdbId ?? params.title ?? "unknown",
      cacheStatus: "none",
      durationMs,
      success: false,
      httpStatus: response.status,
      error,
    });
    throw new Error(error);
  }

  logApiCall({
    api: "omdb",
    op: "fetch",
    endpoint: params.imdbId ?? params.title ?? "unknown",
    cacheStatus: "none",
    durationMs,
    success: true,
    httpStatus: response.status,
  });

  return response.json() as Promise<T>;
}
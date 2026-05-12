import { getRequiredServerEnv } from "@/lib/env";
import { logApiUsage } from "@/lib/api/api-usage-log";
import { assertCanCallApi } from "@/lib/api/rate-limit";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

export type ExternalApiParams = Record<string, string | number | boolean | undefined | null>;

export async function tmdbFetch<T>(
  endpoint: string,
  params: ExternalApiParams = {},
  revalidate = 60,
  language: string | null = "pt-BR",
): Promise<T> {
  const apiKey = getRequiredServerEnv("TMDB_API_KEY");
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  assertCanCallApi("tmdb", normalizedEndpoint);

  const url = new URL(`${TMDB_BASE_URL}${normalizedEndpoint}`);
  url.searchParams.set("api_key", apiKey);
  if (language) url.searchParams.set("language", language);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  let statusCode: number | undefined;

  try {
    const res = await fetch(url.toString(), { next: { revalidate } });
    statusCode = res.status;

    if (!res.ok) {
      throw new Error(`Erro TMDB ${res.status}: ${res.statusText}`);
    }

    logApiUsage({
      apiName: "tmdb",
      endpoint: normalizedEndpoint,
      success: true,
      statusCode,
    });

    return res.json() as Promise<T>;
  } catch (error) {
    logApiUsage({
      apiName: "tmdb",
      endpoint: normalizedEndpoint,
      success: false,
      statusCode,
      errorMessage: error instanceof Error ? error.message : "Erro desconhecido",
    });
    throw error;
  }
}

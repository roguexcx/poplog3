import { getRequiredServerEnv, isMovieOfTheNightEnabled } from "@/lib/env";
import { logApiUsage } from "@/lib/api/api-usage-log";
import { assertCanCallApi } from "@/lib/api/rate-limit";
import type { ExternalApiParams } from "@/lib/api/tmdb";

const MOVIEOFTHENIGHT_BASE_URL = "https://api.movieofthenight.com/v4";

export async function movieOfTheNightFetch<T>(
  endpoint: string,
  params: ExternalApiParams = {},
): Promise<T> {
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  if (!isMovieOfTheNightEnabled()) {
    logApiUsage({
      apiName: "movieofthenight",
      endpoint: normalizedEndpoint,
      success: false,
      skippedReason: "MOVIEOFTHENIGHT_ENABLED=false",
    });
    throw new Error("MovieOfTheNight bloqueado por feature flag.");
  }

  const apiKey = getRequiredServerEnv("MOVIEOFTHENIGHT_API_KEY");
  assertCanCallApi("movieofthenight", normalizedEndpoint);

  const url = new URL(`${MOVIEOFTHENIGHT_BASE_URL}${normalizedEndpoint}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  let statusCode: number | undefined;

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "X-API-Key": apiKey,
      },
    });
    statusCode = res.status;

    if (!res.ok) {
      throw new Error(`Erro MovieOfTheNight ${res.status}: ${res.statusText}`);
    }

    logApiUsage({
      apiName: "movieofthenight",
      endpoint: normalizedEndpoint,
      success: true,
      statusCode,
    });

    return res.json() as Promise<T>;
  } catch (error) {
    logApiUsage({
      apiName: "movieofthenight",
      endpoint: normalizedEndpoint,
      success: false,
      statusCode,
      errorMessage: error instanceof Error ? error.message : "Erro desconhecido",
    });
    throw error;
  }
}

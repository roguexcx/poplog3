import { getRequiredServerEnv, isWatchmodeEnabled } from "@/lib/env";
import { logApiUsage } from "@/lib/api/api-usage-log";
import { assertCanCallApi, } from "@/lib/api/rate-limit";
import type { ExternalApiParams } from "@/lib/api/tmdb";

const WATCHMODE_BASE_URL = "https://api.watchmode.com/v1";

export async function watchmodeFetch<T>(
  endpoint: string,
  params: ExternalApiParams = {},
): Promise<T> {
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

  if (!isWatchmodeEnabled()) {
    logApiUsage({
      apiName: "watchmode",
      endpoint: normalizedEndpoint,
      success: false,
      skippedReason: "WATCHMODE_ENABLED=false",
    });
    throw new Error("Watchmode bloqueado por feature flag.");
  }

  const apiKey = getRequiredServerEnv("WATCHMODE_API_KEY");
  assertCanCallApi("watchmode", normalizedEndpoint);

  const url = new URL(`${WATCHMODE_BASE_URL}${normalizedEndpoint}`);
  url.searchParams.set("apiKey", apiKey);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  let statusCode: number | undefined;

  try {
    const res = await fetch(url.toString());
    statusCode = res.status;

    if (!res.ok) {
      throw new Error(`Erro Watchmode ${res.status}: ${res.statusText}`);
    }

    logApiUsage({
      apiName: "watchmode",
      endpoint: normalizedEndpoint,
      success: true,
      statusCode,
    });

    return res.json() as Promise<T>;
  } catch (error) {
    logApiUsage({
      apiName: "watchmode",
      endpoint: normalizedEndpoint,
      success: false,
      statusCode,
      errorMessage: error instanceof Error ? error.message : "Erro desconhecido",
    });
    throw error;
  }
}

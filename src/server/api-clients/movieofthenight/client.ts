import { logApiCall } from "@/server/engine-logger";

const MOTN_BASE_URL =
  "https://streaming-availability.p.rapidapi.com";

export async function motnFetch<T>(
  path: string
): Promise<T> {
  const apiKey = process.env.MOVIEOFTHENIGHT_API_KEY;

  if (!apiKey) {
    throw new Error("MOVIEOFTHENIGHT_API_KEY não configurada.");
  }

  const t0 = Date.now();

  const response = await fetch(`${MOTN_BASE_URL}${path}`, {
    headers: {
      "X-RapidAPI-Key": apiKey,
    },
    next: {
      revalidate: 60 * 60 * 24 * 14,
    },
  });

  const durationMs = Date.now() - t0;

  if (!response.ok) {
    const error = `MovieOfTheNight request failed: ${response.status}`;
    logApiCall({
      api: "motn",
      op: "fetch",
      endpoint: path,
      cacheStatus: "none",
      durationMs,
      success: false,
      httpStatus: response.status,
      error,
    });
    throw new Error(error);
  }

  logApiCall({
    api: "motn",
    op: "fetch",
    endpoint: path,
    cacheStatus: "none",
    durationMs,
    success: true,
    httpStatus: response.status,
  });

  return response.json() as Promise<T>;
}
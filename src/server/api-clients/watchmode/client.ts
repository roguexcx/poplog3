import { logApiCall } from "@/server/engine-logger";

const WATCHMODE_BASE_URL = "https://api.watchmode.com/v1";

export async function watchmodeFetch<T>(
  path: string
): Promise<T> {
  const apiKey = process.env.WATCHMODE_API_KEY;

  if (!apiKey) {
    throw new Error("WATCHMODE_API_KEY não configurada.");
  }

  const t0 = Date.now();

  const response = await fetch(
    `${WATCHMODE_BASE_URL}${path}${
      path.includes("?") ? "&" : "?"
    }apiKey=${apiKey}`,
    {
      next: {
        revalidate: 60 * 60 * 24 * 7,
      },
    }
  );

  const durationMs = Date.now() - t0;

  if (!response.ok) {
    const error = `Watchmode request failed: ${response.status}`;
    logApiCall({
      api: "watchmode",
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
    api: "watchmode",
    op: "fetch",
    endpoint: path,
    cacheStatus: "none",
    durationMs,
    success: true,
    httpStatus: response.status,
  });

  return response.json() as Promise<T>;
}
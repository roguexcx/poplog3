const WATCHMODE_BASE_URL = "https://api.watchmode.com/v1";

export async function watchmodeFetch<T>(
  path: string
): Promise<T> {
  const apiKey = process.env.WATCHMODE_API_KEY;

  if (!apiKey) {
    throw new Error("WATCHMODE_API_KEY não configurada.");
  }

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

  if (!response.ok) {
    throw new Error(`Watchmode request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
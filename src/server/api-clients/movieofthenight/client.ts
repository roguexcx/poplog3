const MOTN_BASE_URL =
  "https://streaming-availability.p.rapidapi.com";

export async function motnFetch<T>(
  path: string
): Promise<T> {
  const apiKey = process.env.MOVIEOFTHENIGHT_API_KEY;

  if (!apiKey) {
    throw new Error("MOVIEOFTHENIGHT_API_KEY não configurada.");
  }

  const response = await fetch(`${MOTN_BASE_URL}${path}`, {
    headers: {
      "X-RapidAPI-Key": apiKey,
    },
    next: {
      revalidate: 60 * 60 * 24 * 14,
    },
  });

  if (!response.ok) {
    throw new Error(
      `MovieOfTheNight request failed: ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}
// src/lib/tmdb.ts

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

type TMDBParams = Record<string, string | number | boolean | undefined>;

export async function tmdbFetch<T>(
  endpoint: string,
  params: TMDBParams = {},
  revalidate = 60,
  language: string | null = "pt-BR",
): Promise<T> {
  const apiKey = process.env.TMDB_API_KEY;

  if (!apiKey) {
    throw new Error("TMDB_API_KEY não configurada.");
  }

  const url = new URL(`${TMDB_BASE_URL}${endpoint}`);
  url.searchParams.set("api_key", apiKey);
  if (language) url.searchParams.set("language", language);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url.toString(), { next: { revalidate } });

  if (!res.ok) {
    throw new Error(`Erro TMDB ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}
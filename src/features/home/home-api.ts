// src/features/home/home-api.ts

import type { TMDBItem, TMDBMediaType, TMDBResponse } from "@/lib/tmdb-types";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type TMDBDetails = {
  id: number;
  overview?: string;
  genres?: { id: number; name: string }[];
  runtime?: number;
  release_date?: string;
  // TV
  first_air_date?: string;
  number_of_seasons?: number;
  episode_run_time?: number[];
};

// ─── Helpers privados ─────────────────────────────────────────────────────────

function withMediaType(items: TMDBItem[], mediaType: TMDBMediaType): TMDBItem[] {
  return items.map((item) => ({ ...item, media_type: item.media_type ?? mediaType }));
}

async function fetchHomeSection(
  endpoint: string,
  mediaType?: TMDBMediaType,
): Promise<TMDBItem[]> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}${endpoint}`, {
    next: { revalidate: 300 }, // 5 min — evita no-store em cada request
  });

  if (!res.ok) return [];

  const data: TMDBResponse<TMDBItem> = await res.json();
  const results = data.results ?? [];

  return mediaType ? withMediaType(results, mediaType) : results;
}

// ─── Exports públicos ─────────────────────────────────────────────────────────

export async function getTrending(): Promise<TMDBItem[]> {
  return fetchHomeSection("/api/trending");
}

export async function getPopularMovies(): Promise<TMDBItem[]> {
  return fetchHomeSection("/api/popular", "movie");
}

export async function getPopularTV(): Promise<TMDBItem[]> {
  return fetchHomeSection("/api/tv-popular", "tv");
}

export async function getUpcomingMovies(): Promise<TMDBItem[]> {
  return fetchHomeSection("/api/upcoming", "movie");
}

export async function getFeaturedDetails(
  mediaType: "movie" | "tv",
  id: number,
): Promise<TMDBDetails | null> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL}/api/tmdb/${mediaType}/${id}`,
    { next: { revalidate: 300 } },
  );

  if (!res.ok) return null;
  return res.json() as Promise<TMDBDetails>;
}
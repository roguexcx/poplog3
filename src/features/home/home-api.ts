// src/features/home/home-api.ts

import type { TMDBItem, TMDBMediaType, TMDBResponse, TMDBDetails } from "@/types/tmdb";

// Re-export so HomePage.tsx can use the type without changing its import
export type { TMDBDetails };

// ─── Helpers privados ─────────────────────────────────────────────────────────

function withMediaType(items: TMDBItem[], mediaType: TMDBMediaType): TMDBItem[] {
  return items.map((item) => ({ ...item, media_type: item.media_type ?? mediaType }));
}

async function fetchList(
  type: string,
  media?: "movie" | "tv",
): Promise<TMDBItem[]> {
  const params = new URLSearchParams({ type });
  if (media) params.set("media", media);

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL}/api/tmdb/list?${params.toString()}`,
    { next: { revalidate: 300 } },
  );

  if (!res.ok) return [];

  const data: TMDBResponse<TMDBItem> = await res.json();
  const results = data.results ?? [];

  return media ? withMediaType(results, media) : results;
}

// ─── Exports públicos ─────────────────────────────────────────────────────────

export async function getTrending(): Promise<TMDBItem[]> {
  return fetchList("trending");
}

export async function getPopularMovies(): Promise<TMDBItem[]> {
  return fetchList("popular", "movie");
}

export async function getPopularTV(): Promise<TMDBItem[]> {
  return fetchList("popular", "tv");
}

export async function getUpcomingMovies(): Promise<TMDBItem[]> {
  return fetchList("upcoming");
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

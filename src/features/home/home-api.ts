import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import type { TMDBItem, TMDBDetails } from "@/types/tmdb";

export type { TMDBDetails };

// ─── Exports públicos ─────────────────────────────────────────────────────────

export async function getTrending(): Promise<TMDBItem[]> {
  try {
    const data = await tmdbFetch<{ results: TMDBItem[] }>("/trending/all/week", {
      params: { page: 1 },
      revalidate: 300,
    });
    return (data.results ?? []).map((item) => ({
      ...item,
      media_type: item.media_type ?? (item.title ? "movie" : "tv"),
    }));
  } catch {
    return [];
  }
}

export async function getPopularMovies(): Promise<TMDBItem[]> {
  try {
    const data = await tmdbFetch<{ results: TMDBItem[] }>("/movie/popular", {
      params: { page: 1 },
      revalidate: 300,
    });
    return (data.results ?? []).map((item) => ({ ...item, media_type: "movie" as const }));
  } catch {
    return [];
  }
}

export async function getPopularTV(): Promise<TMDBItem[]> {
  try {
    const data = await tmdbFetch<{ results: TMDBItem[] }>("/tv/popular", {
      params: { page: 1 },
      revalidate: 300,
    });
    return (data.results ?? []).map((item) => ({ ...item, media_type: "tv" as const }));
  } catch {
    return [];
  }
}

export async function getFeaturedDetails(
  mediaType: "movie" | "tv",
  id: number,
): Promise<TMDBDetails | null> {
  try {
    return await tmdbFetch<TMDBDetails>(`/${mediaType}/${id}`, {
      revalidate: 300,
    });
  } catch {
    return null;
  }
}

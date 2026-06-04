import type { TMDBItem, TMDBDetails } from "@/types/tmdb";

export type { TMDBDetails };

export async function getTrending(): Promise<TMDBItem[]> {
  return [];
}

export async function getPopularMovies(): Promise<TMDBItem[]> {
  return [];
}

export async function getPopularTV(): Promise<TMDBItem[]> {
  return [];
}

export async function getFeaturedDetails(
  _mediaType: "movie" | "tv",
  _id: number,
): Promise<TMDBDetails | null> {
  return null;
}

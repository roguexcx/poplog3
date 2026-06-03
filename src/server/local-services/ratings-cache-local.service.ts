import {
  deleteRatingsCache,
  getCachedRatingsRow,
  isRatingsCacheFresh,
  upsertRatingsCache,
} from "@/server/repositories";
import type { PoplogRatings } from "@/server/types/ratings";

type MediaType = "movie" | "tv";

export type CachedRatings = PoplogRatings & {
  tmdb_id: number;
  media_type: MediaType;
  updated_at: string | null;
};

export type UpsertRatingsInput = {
  tmdbId: number;
  mediaType: MediaType;
  imdbRating?: number | null;
  imdbVotes?: number | null;
  rottenTomatoesScore?: number | null;
  metacriticScore?: number | null;
  tmdbRating?: number | null;
  poplogScore?: number | null;
  sourcePayload?: unknown;
};

export async function getCachedRatings(
  mediaType: MediaType,
  tmdbId: number,
): Promise<CachedRatings | null> {
  const row = await getCachedRatingsRow(mediaType, tmdbId);
  if (!row) return null;

  return {
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    imdb_rating: row.imdbRating === null ? undefined : Number(row.imdbRating),
    imdb_votes: row.imdbVotes ?? undefined,
    rotten_tomatoes_score: row.rottenTomatoesScore ?? undefined,
    metacritic_score: row.metacriticScore ?? undefined,
    tmdb_rating: row.tmdbRating === null ? undefined : Number(row.tmdbRating),
    poplog_score: row.poplogScore ?? undefined,
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function upsertRatings(input: UpsertRatingsInput): Promise<void> {
  const ok = await upsertRatingsCache(input);
  if (!ok) throw new Error(`Falha ao persistir ratings locais ${input.mediaType}/${input.tmdbId}`);
}

export async function deleteCachedRatings(mediaType: MediaType, tmdbId: number): Promise<boolean> {
  return deleteRatingsCache(mediaType, tmdbId);
}

export { isRatingsCacheFresh };

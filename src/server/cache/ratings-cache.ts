import type { PoplogRatings } from "@/server/types/ratings";

type MediaType = "movie" | "tv";

export type CachedRatings = PoplogRatings & {
  tmdb_id: number;
  media_type: MediaType;
  updated_at: string | null;
};

/**
 * Le os ratings cacheados de um titulo, se existirem.
 * Nao olha frescor — isso eh decisao da camada de sync.
 */
export async function getCachedRatings(
  mediaType: MediaType,
  tmdbId: number
): Promise<CachedRatings | null> {
  const local = await import("@/server/local-services/ratings-cache-local.service");
  return await local.getCachedRatings(mediaType, tmdbId);
}

/**
 * Considera o cache fresco se foi atualizado dentro do maxAgeDays.
 * Default: 30 dias — alinhado com o TTL de OMDb.
 */
export function isRatingsCacheFresh(
  updatedAt: string | null | undefined,
  maxAgeDays = 30
): boolean {
  if (!updatedAt) return false;

  const t = new Date(updatedAt).getTime();

  if (!Number.isFinite(t)) return false;

  const ageDays =
    (Date.now() - t) /
    (24 * 60 * 60 * 1000);

  return ageDays <= maxAgeDays;
}

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

export async function upsertRatings(
  input: UpsertRatingsInput
): Promise<void> {
  const local = await import("@/server/local-services/ratings-cache-local.service");
  await local.upsertRatings(input);
}

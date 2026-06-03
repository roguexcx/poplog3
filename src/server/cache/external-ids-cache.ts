type MediaType = "movie" | "tv";

export type ExternalIdsRow = {
  tmdb_id: number;
  media_type: MediaType;
  imdb_id: string | null;
  tvdb_id: string | null;
  trakt_id: string | null;
  watchmode_id: number | null;
  motn_id: string | null;
};

export async function getExternalIds(
  mediaType: MediaType,
  tmdbId: number
): Promise<ExternalIdsRow | null> {
  const local = await import("@/server/local-services/external-ids-cache-local.service");
  return await local.getExternalIds(mediaType, tmdbId);
}

export type UpsertExternalIdsInput = {
  tmdbId: number;
  mediaType: MediaType;
  imdbId?: string | null;
  tvdbId?: string | null;
  traktId?: string | null;
  watchmodeId?: number | null;
  motnId?: string | null;
};

/**
 * Upsert preservando IDs ja conhecidos quando o novo payload vier null.
 */
export async function upsertExternalIds(
  input: UpsertExternalIdsInput
): Promise<void> {
  const local = await import("@/server/local-services/external-ids-cache-local.service");
  await local.upsertExternalIds(input);
}

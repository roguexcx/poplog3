import {
  deleteExternalIdsCache,
  getExternalIdsCache,
  upsertExternalIdsCache,
} from "@/server/repositories";

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

export type UpsertExternalIdsInput = {
  tmdbId: number;
  mediaType: MediaType;
  imdbId?: string | null;
  tvdbId?: string | null;
  traktId?: string | null;
  watchmodeId?: number | null;
  motnId?: string | null;
};

export async function getExternalIds(
  mediaType: MediaType,
  tmdbId: number,
): Promise<ExternalIdsRow | null> {
  const row = await getExternalIdsCache(mediaType, tmdbId);
  if (!row) return null;
  return {
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    imdb_id: row.imdbId,
    tvdb_id: row.tvdbId,
    trakt_id: row.traktId,
    watchmode_id: row.watchmodeId,
    motn_id: row.motnId,
  };
}

export async function upsertExternalIds(input: UpsertExternalIdsInput): Promise<void> {
  await upsertExternalIdsCache(input);
}

export async function deleteExternalIds(mediaType: MediaType, tmdbId: number): Promise<boolean> {
  return deleteExternalIdsCache(mediaType, tmdbId);
}

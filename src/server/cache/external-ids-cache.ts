import { supabaseAdmin } from "@/server/supabase/admin";

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
  const { data, error } = await supabaseAdmin
    .from("title_external_ids")
    .select("tmdb_id, media_type, imdb_id, tvdb_id, trakt_id, watchmode_id, motn_id")
    .eq("media_type", mediaType)
    .eq("tmdb_id", tmdbId)
    .maybeSingle();

  if (error) {
    console.error("[external-ids-cache/get]", error);
    return null;
  }

  return data as ExternalIdsRow | null;
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
  const existing = await getExternalIds(input.mediaType, input.tmdbId);

  const merged = {
    tmdb_id: input.tmdbId,
    media_type: input.mediaType,
    imdb_id: input.imdbId ?? existing?.imdb_id ?? null,
    tvdb_id: input.tvdbId ?? existing?.tvdb_id ?? null,
    trakt_id: input.traktId ?? existing?.trakt_id ?? null,
    watchmode_id: input.watchmodeId ?? existing?.watchmode_id ?? null,
    motn_id: input.motnId ?? existing?.motn_id ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("title_external_ids")
    .upsert(merged, { onConflict: "tmdb_id,media_type" });

  if (error) {
    console.error("[external-ids-cache/upsert]", error);
  }
}

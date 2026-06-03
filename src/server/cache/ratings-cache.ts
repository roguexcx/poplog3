import { isLocalCacheEnabled } from "@/server/runtime/local-db-flags";
import type { PoplogRatings } from "@/server/types/ratings";

type MediaType = "movie" | "tv";

export type CachedRatings = PoplogRatings & {
  tmdb_id: number;
  media_type: MediaType;
  updated_at: string | null;
};

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/server/supabase/admin");
  return supabaseAdmin;
}

/**
 * Le os ratings cacheados de um titulo, se existirem.
 * Nao olha frescor — isso eh decisao da camada de sync.
 */
export async function getCachedRatings(
  mediaType: MediaType,
  tmdbId: number
): Promise<CachedRatings | null> {
  if (isLocalCacheEnabled()) {
    try {
      const local = await import("@/server/local-services/ratings-cache-local.service");
      return await local.getCachedRatings(mediaType, tmdbId);
    } catch (err) {
      console.warn("[ratings-cache/getCachedRatings] local cache failed, falling back to Supabase:", err);
    }
  }

  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("title_ratings")
    .select(
      "tmdb_id, media_type, imdb_rating, imdb_votes, rotten_tomatoes_score, metacritic_score, tmdb_rating, poplog_score, updated_at"
    )
    .eq("media_type", mediaType)
    .eq("tmdb_id", tmdbId)
    .maybeSingle();

  if (error) {
    console.error(
      "[ratings-cache/getCachedRatings]",
      error
    );
    return null;
  }

  if (!data) return null;

  return {
    tmdb_id: data.tmdb_id,
    media_type: data.media_type,
    imdb_rating: data.imdb_rating ?? undefined,
    imdb_votes: data.imdb_votes ?? undefined,
    rotten_tomatoes_score:
      data.rotten_tomatoes_score ?? undefined,
    metacritic_score:
      data.metacritic_score ?? undefined,
    tmdb_rating: data.tmdb_rating ?? undefined,
    poplog_score: data.poplog_score ?? undefined,
    updated_at: data.updated_at ?? null,
  };
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
  if (isLocalCacheEnabled()) {
    try {
      const local = await import("@/server/local-services/ratings-cache-local.service");
      await local.upsertRatings(input);
      return;
    } catch (err) {
      console.warn("[ratings-cache/upsertRatings] local cache failed, falling back to Supabase:", err);
    }
  }

  const now = new Date().toISOString();
  const supabaseAdmin = await getSupabaseAdmin();

  const { error } = await supabaseAdmin
    .from("title_ratings")
    .upsert(
      {
        tmdb_id: input.tmdbId,
        media_type: input.mediaType,

        imdb_rating:
          input.imdbRating ?? null,

        imdb_votes:
          input.imdbVotes ?? null,

        rotten_tomatoes_score:
          input.rottenTomatoesScore ?? null,

        metacritic_score:
          input.metacriticScore ?? null,

        tmdb_rating:
          input.tmdbRating ?? null,

        poplog_score:
          input.poplogScore ?? null,

        source_payload:
          input.sourcePayload ?? null,

        updated_at: now,
      },
      {
        onConflict:
          "tmdb_id,media_type",
      }
    );

  if (error) {
    console.error(
      "[ratings-cache/upsertRatings]",
      error
    );

    throw new Error(
      `Falha ao persistir ratings ${input.mediaType}/${input.tmdbId}: ${error.message}`
    );
  }
}

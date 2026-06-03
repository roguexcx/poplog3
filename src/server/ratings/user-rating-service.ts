/**
 * user-rating-service.ts
 *
 * CRUD de avaliacoes pessoais do usuario (tabela user_ratings).
 * Escala 0-5, incrementos de 0.5 estrelas.
 *
 * Apos cada mutacao (upsert / delete) aguarda recalculateAggregate()
 * para manter os agregados publicos em sincronia antes da resposta da API.
 */

import { isLocalUserRatingsEnabled } from "@/server/runtime/local-db-flags";
import type { RatingMediaType, RatingSource, UserRatingData } from "@/types/user";

export type { RatingMediaType, RatingSource, UserRatingData };

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getLocalUserRatingsService() {
  return import("@/server/local-services/user-ratings-local.service");
}

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/server/supabase/admin");
  return supabaseAdmin;
}

async function recalculateAggregateFor(input: {
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}) {
  const { recalculateAggregate } = await import("./rating-aggregate-service");
  return recalculateAggregate(input);
}

function serializeError(err: unknown): string {
  if (!err) return String(err);
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  const e = err as Record<string, unknown>;
  const parts: string[] = [];
  if (e["message"]) parts.push(String(e["message"]));
  if (e["code"]) parts.push(`code=${String(e["code"])}`);
  if (e["details"]) parts.push(`details=${String(e["details"])}`);
  return parts.length > 0 ? parts.join(" | ") : JSON.stringify(err);
}

function isTableMissingError(err: unknown): boolean {
  const e = err as Record<string, unknown> | null;
  if (!e) return false;
  if (e["code"] === "42P01") return true;
  const msg = String(e["message"] ?? "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation");
}

function buildItemKey(
  mediaType: RatingMediaType,
  tmdbId: number,
  seasonNumber?: number | null,
  episodeNumber?: number | null
): string {
  return (
    `${mediaType}:${tmdbId}` +
    `:${seasonNumber ?? ""}` +
    `:${episodeNumber ?? ""}`
  );
}

function clampRating(value: number): number {
  const rounded = Math.round(value * 2) / 2; // arredonda para 0.5
  return Math.min(5, Math.max(0, rounded));
}

function roundAverageRating(value: number): number {
  return Math.min(5, Math.max(0, Math.round(value * 10) / 10));
}

function mapRow(row: Record<string, unknown>): UserRatingData {
  return {
    rating: Number(row.rating),
    ratingSource: (row.rating_source as RatingSource) ?? "explicit",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const directRatingSources = new Set<RatingSource>(["explicit", "imported"]);

async function syncSeriesRatingFromEpisodes(
  userId: string,
  tmdbId: number
): Promise<void> {
  const seriesItemKey = buildItemKey("tv", tmdbId, null, null);

  const { data: existingSeriesRating, error: existingError } = await (await getSupabaseAdmin()).from("user_ratings")
    .select("rating_source")
    .eq("user_id", userId)
    .eq("item_key", seriesItemKey)
    .maybeSingle();

  if (existingError) {
    if (!isTableMissingError(existingError)) {
      console.error(
        "[user-rating-service/syncSeriesRatingFromEpisodes] existing lookup",
        serializeError(existingError)
      );
    }
    return;
  }

  const existingSource = existingSeriesRating?.rating_source as
    | RatingSource
    | undefined;

  if (existingSource && directRatingSources.has(existingSource)) {
    await recalculateAggregateFor({ mediaType: "tv", tmdbId });
    return;
  }

  const { data: episodeRatings, error: episodeError } = await (await getSupabaseAdmin()).from("user_ratings")
    .select("rating")
    .eq("user_id", userId)
    .eq("media_type", "episode")
    .eq("tmdb_id", tmdbId)
    .eq("is_public", true)
    .in("rating_source", ["explicit", "imported"]);

  if (episodeError) {
    if (!isTableMissingError(episodeError)) {
      console.error(
        "[user-rating-service/syncSeriesRatingFromEpisodes] episode lookup",
        serializeError(episodeError)
      );
    }
    return;
  }

  if (!episodeRatings || episodeRatings.length === 0) {
    if (existingSource) {
      const { error: deleteError } = await (await getSupabaseAdmin()).from("user_ratings")
        .delete()
        .eq("user_id", userId)
        .eq("item_key", seriesItemKey);

      if (deleteError) {
        console.error(
          "[user-rating-service/syncSeriesRatingFromEpisodes] delete inferred",
          serializeError(deleteError)
        );
        return;
      }
    }

    await recalculateAggregateFor({ mediaType: "tv", tmdbId });
    return;
  }

  const average = roundAverageRating(
    episodeRatings.reduce((sum, row) => sum + Number(row.rating), 0) /
      episodeRatings.length
  );
  const now = new Date().toISOString();

  const { error: upsertError } = await (await getSupabaseAdmin()).from("user_ratings")
    .upsert(
      {
        user_id: userId,
        media_type: "tv",
        tmdb_id: tmdbId,
        season_number: null,
        episode_number: null,
        rating: average,
        rating_source: "inferred",
        is_public: true,
        updated_at: now,
      },
      {
        onConflict: "user_id,item_key",
        ignoreDuplicates: false,
      }
    );

  if (upsertError) {
    console.error(
      "[user-rating-service/syncSeriesRatingFromEpisodes] upsert inferred",
      serializeError(upsertError)
    );
    return;
  }

  await recalculateAggregateFor({ mediaType: "tv", tmdbId });
}

// ── Leitura individual ────────────────────────────────────────────────────────

/**
 * Retorna a avaliacao pessoal de um usuario para um item especifico.
 * Retorna null se o usuario ainda nao avaliou.
 */
export async function getUserRating(
  userId: string,
  mediaType: RatingMediaType,
  tmdbId: number,
  seasonNumber?: number | null,
  episodeNumber?: number | null
): Promise<UserRatingData | null> {
  if (isLocalUserRatingsEnabled()) {
    const local = await getLocalUserRatingsService();
    return local.getUserRating(userId, mediaType, tmdbId, seasonNumber, episodeNumber);
  }

  const itemKey = buildItemKey(mediaType, tmdbId, seasonNumber, episodeNumber);

  const { data, error } = await (await getSupabaseAdmin()).from("user_ratings")
    .select("rating, rating_source, created_at, updated_at")
    .eq("user_id", userId)
    .eq("item_key", itemKey)
    .maybeSingle();

  if (error) {
    if (!isTableMissingError(error)) {
      console.error("[user-rating-service/getUserRating]", serializeError(error));
    }
    return null;
  }

  if (!data) return null;

  return mapRow(data as Record<string, unknown>);
}

// ── Leitura em lote ───────────────────────────────────────────────────────────

export type BatchRatingItem = {
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

export type BatchRatingResult = Map<string, UserRatingData>;

/**
 * Carrega avaliacoes de multiplos titulos em uma unica query.
 * Retorna um Map keyed por item_key.
 * Usado por Biblioteca, Acompanhando, Cards de busca, etc.
 */
export async function getUserRatingsBatch(
  userId: string,
  items: BatchRatingItem[]
): Promise<BatchRatingResult> {
  if (isLocalUserRatingsEnabled()) {
    const local = await getLocalUserRatingsService();
    return local.getUserRatingsBatch(userId, items);
  }

  if (items.length === 0) return new Map();

  const keys = items.map((i) =>
    buildItemKey(i.mediaType, i.tmdbId, i.seasonNumber, i.episodeNumber)
  );

  const { data, error } = await (await getSupabaseAdmin()).from("user_ratings")
    .select("item_key, rating, rating_source, created_at, updated_at")
    .eq("user_id", userId)
    .in("item_key", keys);

  if (error) {
    if (!isTableMissingError(error)) {
      console.error("[user-rating-service/getUserRatingsBatch]", serializeError(error));
    }
    return new Map();
  }

  const result: BatchRatingResult = new Map();

  for (const row of data ?? []) {
    result.set(
      String(row.item_key),
      mapRow(row as Record<string, unknown>)
    );
  }

  return result;
}

// ── Mutacoes ──────────────────────────────────────────────────────────────────

export type UpsertRatingInput = {
  userId: string;
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  rating: number;
  ratingSource?: RatingSource;
  isPublic?: boolean;
};

/**
 * Cria ou atualiza a avaliacao pessoal do usuario.
 * Se o usuario alterar a nota, atualiza e recalcula os agregados.
 * Retorna a avaliacao salva.
 */
export async function upsertUserRating(
  input: UpsertRatingInput
): Promise<UserRatingData> {
  if (isLocalUserRatingsEnabled()) {
    const local = await getLocalUserRatingsService();
    return local.upsertUserRating(input);
  }

  const {
    userId,
    mediaType,
    tmdbId,
    seasonNumber = null,
    episodeNumber = null,
    ratingSource = "explicit",
    isPublic = true,
  } = input;

  const rating = clampRating(input.rating);
  const now = new Date().toISOString();

  const { data, error } = await (await getSupabaseAdmin()).from("user_ratings")
    .upsert(
      {
        user_id: userId,
        media_type: mediaType,
        tmdb_id: tmdbId,
        season_number: seasonNumber,
        episode_number: episodeNumber,
        rating,
        rating_source: ratingSource,
        is_public: isPublic,
        updated_at: now,
      },
      {
        onConflict: "user_id,item_key",
        ignoreDuplicates: false,
      }
    )
    .select("rating, rating_source, created_at, updated_at")
    .single();

  if (error) {
    console.error("[user-rating-service/upsertUserRating]", serializeError(error));
    throw new Error(
      `Falha ao salvar avaliacao ${mediaType}/${tmdbId}: ${serializeError(error)}`
    );
  }

  await recalculateAggregateFor({ mediaType, tmdbId, seasonNumber, episodeNumber });
  if (mediaType === "episode") {
    await syncSeriesRatingFromEpisodes(userId, tmdbId);
  }

  return mapRow(data as Record<string, unknown>);
}

export type DeleteRatingInput = {
  userId: string;
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

/**
 * Remove a avaliacao pessoal do usuario.
 * Recalcula os agregados publicos apos a remocao.
 */
export async function deleteUserRating(
  input: DeleteRatingInput
): Promise<void> {
  if (isLocalUserRatingsEnabled()) {
    const local = await getLocalUserRatingsService();
    return local.deleteUserRating(input);
  }

  const {
    userId,
    mediaType,
    tmdbId,
    seasonNumber = null,
    episodeNumber = null,
  } = input;

  const itemKey = buildItemKey(mediaType, tmdbId, seasonNumber, episodeNumber);

  const { error } = await (await getSupabaseAdmin()).from("user_ratings")
    .delete()
    .eq("user_id", userId)
    .eq("item_key", itemKey);

  if (error) {
    console.error("[user-rating-service/deleteUserRating]", serializeError(error));
    throw new Error(
      `Falha ao remover avaliacao ${mediaType}/${tmdbId}: ${serializeError(error)}`
    );
  }

  await recalculateAggregateFor({ mediaType, tmdbId, seasonNumber, episodeNumber });
  if (mediaType === "episode") {
    await syncSeriesRatingFromEpisodes(userId, tmdbId);
  } else if (mediaType === "tv" && seasonNumber === null && episodeNumber === null) {
    await syncSeriesRatingFromEpisodes(userId, tmdbId);
  }
}



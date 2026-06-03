/**
 * user-rating-service.ts
 *
 * CRUD de avaliacoes pessoais do usuario (tabela user_ratings).
 * Escala 0-5, incrementos de 0.5 estrelas.
 *
 * Apos cada mutacao (upsert / delete) aguarda recalculateAggregate()
 * para manter os agregados publicos em sincronia antes da resposta da API.
 */

import type { RatingMediaType, RatingSource, UserRatingData } from "@/types/user";

export type { RatingMediaType, RatingSource, UserRatingData };

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getLocalUserRatingsService() {
  return import("@/server/local-services/user-ratings-local.service");
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
  const local = await getLocalUserRatingsService();
  return local.getUserRating(userId, mediaType, tmdbId, seasonNumber, episodeNumber);
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
  const local = await getLocalUserRatingsService();
  return local.getUserRatingsBatch(userId, items);
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
  const local = await getLocalUserRatingsService();
  const saved = await local.upsertUserRating(input);
  await recalculateAggregateFor({
    mediaType: input.mediaType,
    tmdbId: input.tmdbId,
    seasonNumber: input.seasonNumber ?? null,
    episodeNumber: input.episodeNumber ?? null,
  });
  if (input.mediaType === "episode" || (input.mediaType === "tv" && input.seasonNumber == null && input.episodeNumber == null)) {
    await recalculateAggregateFor({ mediaType: "tv", tmdbId: input.tmdbId });
  }
  return saved;
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
  const local = await getLocalUserRatingsService();
  await local.deleteUserRating(input);
  await recalculateAggregateFor({
    mediaType: input.mediaType,
    tmdbId: input.tmdbId,
    seasonNumber: input.seasonNumber ?? null,
    episodeNumber: input.episodeNumber ?? null,
  });
  if (input.mediaType === "episode" || (input.mediaType === "tv" && input.seasonNumber == null && input.episodeNumber == null)) {
    await recalculateAggregateFor({ mediaType: "tv", tmdbId: input.tmdbId });
  }
}

import { omdbFetch } from "@/server/api-clients/omdb/client";
import type { OmdbTitleResponse } from "@/server/api-clients/omdb/types";

import {
  getCachedRatings,
  isRatingsCacheFresh,
  upsertRatings,
  type CachedRatings,
} from "@/server/cache/ratings-cache";

import { normalizeOmdbRatings } from "@/server/normalizers/omdb-ratings";
import { computePoplogScore } from "@/lib/score";

type MediaType = "movie" | "tv";

export type SyncOmdbInput = {
  tmdbId: number;
  mediaType: MediaType;

  /** IMDb id (tt...). Quando ausente, sync nao roda. */
  imdbId?: string | null;

  /** TMDB rating canonico (0-10). Entra no calculo do POPLOG Score. */
  tmdbRating?: number | null;

  /** Forca refetch ignorando frescor. */
  force?: boolean;

  /** Janela de frescor em dias. Default: 30. */
  maxAgeDays?: number;
};

export type SyncOmdbResult = {
  source: "cache" | "omdb" | "skipped";

  cache_status:
    | "fresh"
    | "created"
    | "stale_refreshed"
    | "force_refreshed"
    | "no_imdb_id"
    | "omdb_failed";

  ratings: CachedRatings | null;
};

/**
 * Garante ratings OMDb + POPLOG Score atualizados para um titulo.
 *
 * - Se ja temos ratings frescos no cache, retorna sem chamar a API.
 * - Se nao temos imdb_id, nao da pra perguntar pro OMDb — retorna skipped.
 * - Em caso de erro de rede no OMDb, retorna o cache antigo (se existir).
 */
export async function syncOmdbRatings(
  input: SyncOmdbInput
): Promise<SyncOmdbResult> {
  const { tmdbId, mediaType } = input;

  const maxAgeDays = input.maxAgeDays ?? 30;

  const cached = await getCachedRatings(
    mediaType,
    tmdbId
  );

  /**
   * IMPORTANTE:
   * Algumas séries foram cacheadas sem Rotten/Metacritic.
   * Não queremos considerar isso “fresh” eternamente.
   */
  const cacheHasEnoughData =
    cached &&
    (
      typeof cached.imdb_rating === "number" ||
      typeof cached.rotten_tomatoes_score === "number" ||
      typeof cached.metacritic_score === "number"
    );

  if (
    !input.force &&
    cached &&
    cacheHasEnoughData &&
    isRatingsCacheFresh(
      cached.updated_at,
      maxAgeDays
    )
  ) {
    return {
      source: "cache",
      cache_status: "fresh",
      ratings: cached,
    };
  }

  if (!input.imdbId) {
    console.warn(
      `[sync-omdb-ratings] sem imdb_id para ${mediaType}/${tmdbId}`
    );

    // Mesmo sem IMDb id:
    // ainda conseguimos gerar score parcial usando TMDB.
    if (input.tmdbRating != null) {
      const score = computePoplogScore({
        tmdb: input.tmdbRating,
      });

      await upsertRatings({
        tmdbId,
        mediaType,
        tmdbRating: input.tmdbRating,
        poplogScore: score?.score ?? null,
      });

      const next = await getCachedRatings(
        mediaType,
        tmdbId
      );

      return {
        source: "skipped",
        cache_status: "no_imdb_id",
        ratings: next,
      };
    }

    return {
      source: "skipped",
      cache_status: "no_imdb_id",
      ratings: cached,
    };
  }

  console.log(
    "[sync-omdb-ratings] buscando OMDb",
    {
      tmdbId,
      mediaType,
      imdbId: input.imdbId,
    }
  );

  let response: OmdbTitleResponse;

  try {
    response = await omdbFetch<OmdbTitleResponse>({
      imdbId: input.imdbId,
    });
  } catch (error) {
    console.warn(
      `[sync-omdb-ratings] OMDb falhou para ${input.imdbId}:`,
      error instanceof Error
        ? error.message
        : error
    );

    return {
      source: "cache",
      cache_status: "omdb_failed",
      ratings: cached,
    };
  }

  if (response.Response === "False") {
    console.warn(
      `[sync-omdb-ratings] OMDb retornou False para ${input.imdbId}: ${response.Error ?? ""}`
    );

    return {
      source: "cache",
      cache_status: "omdb_failed",
      ratings: cached,
    };
  }

  console.log(
    "[sync-omdb-ratings] resposta OMDb",
    {
      title: response.Title,
      type: response.Type,
      imdb: response.imdbRating,
      metascore: response.Metascore,
      ratings: response.Ratings,
    }
  );

  const normalized =
    normalizeOmdbRatings(response);

  console.log(
    "[sync-omdb-ratings] normalized",
    {
      imdb: normalized.imdb_rating,
      rotten:
        normalized.rotten_tomatoes_score,
      metacritic:
        normalized.metacritic_score,
    }
  );

  const score = computePoplogScore({
    imdb: normalized.imdb_rating,

    rottenTomatoes:
      normalized.rotten_tomatoes_score,

    metacritic:
      normalized.metacritic_score,

    tmdb: input.tmdbRating,
  });

  await upsertRatings({
    tmdbId,
    mediaType,

    imdbRating:
      normalized.imdb_rating ?? null,

    imdbVotes:
      normalized.imdb_votes ?? null,

    rottenTomatoesScore:
      normalized.rotten_tomatoes_score ??
      null,

    metacriticScore:
      normalized.metacritic_score ??
      null,

    tmdbRating:
      input.tmdbRating ?? null,

    poplogScore:
      score?.score ?? null,

    sourcePayload: response,
  });

  const next = await getCachedRatings(
    mediaType,
    tmdbId
  );

  const cache_status: SyncOmdbResult["cache_status"] =
    input.force
      ? "force_refreshed"
      : cached
        ? "stale_refreshed"
        : "created";

  return {
    source: "omdb",
    cache_status,
    ratings: next,
  };
}
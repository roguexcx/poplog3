import { logApiCall } from "@/server/engine-logger";
import { omdbFetch } from "@/server/api-clients/omdb/client";
import type { OmdbTitleResponse } from "@/server/api-clients/omdb/types";
import { catalogGetRatings } from "@/server/source-engine/engine";
import {
  completePremiumApiBudget,
  reservePremiumApiBudget,
  runPremiumApiQueued,
} from "@/server/rate-limits/premium-api-budget";

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

  /** OMDb é premium: só callers controlados podem permitir fetch externo. */
  allowExternalRefresh?: boolean;

  origin?: {
    endpoint?: string | null;
    userId?: string | null;
    action?: string | null;
    reason?: string | null;
  };
};

export type SyncOmdbResult = {
  source: "cache" | "omdb" | "balloonerismm" | "skipped";

  cache_status:
    | "fresh"
    | "created"
    | "stale_refreshed"
    | "force_refreshed"
    | "no_imdb_id"
    | "external_blocked"
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
  const t0 = Date.now();
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

  if (!input.force && cached) {
    if (
      cacheHasEnoughData &&
      isRatingsCacheFresh(cached.updated_at, maxAgeDays)
    ) {
      logApiCall({
        api: "omdb",
        op: "sync-ratings",
        mediaType,
        tmdbId,
        cacheStatus: "hit",
        durationMs: Date.now() - t0,
        success: true,
      });
      return {
        source: "cache",
        cache_status: "fresh",
        ratings: cached,
      };
    }

    // Sem dados completos mas tentamos recentemente — cooldown de 1 dia
    // para evitar burn loop quando OMDb falhou ou não tem dados para o título.
    if (
      !cacheHasEnoughData &&
      isRatingsCacheFresh(cached.updated_at, 1)
    ) {
      logApiCall({
        api: "omdb",
        op: "sync-ratings",
        mediaType,
        tmdbId,
        cacheStatus: "hit",
        durationMs: Date.now() - t0,
        success: true,
      });
      return {
        source: "cache",
        cache_status: "fresh",
        ratings: cached,
      };
    }
  }

  if (!input.imdbId) {
    logApiCall({
      api: "omdb",
      op: "sync-ratings",
      mediaType,
      tmdbId,
      cacheStatus: "skipped",
      durationMs: Date.now() - t0,
      success: true,
    });
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

  const imdbId = input.imdbId;

  if (!input.allowExternalRefresh) {
    logApiCall({
      api: "omdb",
      op: "sync-ratings",
      mediaType,
      tmdbId,
      endpoint: input.origin?.endpoint ?? imdbId,
      cacheStatus: "skipped",
      durationMs: Date.now() - t0,
      success: true,
    });

    if (input.tmdbRating != null && !cached) {
      const score = computePoplogScore({ tmdb: input.tmdbRating });
      await upsertRatings({
        tmdbId,
        mediaType,
        tmdbRating: input.tmdbRating,
        poplogScore: score?.score ?? null,
      }).catch(() => {});

      const next = await getCachedRatings(mediaType, tmdbId);
      return {
        source: "skipped",
        cache_status: "no_imdb_id",
        ratings: next,
      };
    }

    console.info("[sync-omdb-ratings] external refresh blocked for cache-first display", {
      endpoint: input.origin?.endpoint ?? "unknown",
      tmdbId,
      mediaType,
      userId: input.origin?.userId ?? null,
      action: input.origin?.action ?? null,
      reason: input.origin?.reason ?? "display_cache_first",
    });

    return {
      source: "cache",
      cache_status: "external_blocked",
      ratings: cached,
    };
  }

  const budget = await reservePremiumApiBudget("omdb", {
    endpoint: input.origin?.endpoint ?? null,
    tmdbId,
    mediaType,
    region: null,
    userId: input.origin?.userId ?? null,
    action: input.origin?.action ?? null,
    reason: input.origin?.reason ?? "ratings_cache_expired",
  });

  if (!budget.ok) {
    logApiCall({
      api: "omdb",
      op: "sync-ratings",
      mediaType,
      tmdbId,
      endpoint: input.origin?.endpoint ?? imdbId,
      cacheStatus: "skipped",
      durationMs: Date.now() - t0,
      success: true,
      error: budget.reason,
    });

    return {
      source: "cache",
      cache_status: "omdb_failed",
      ratings: cached,
    };
  }

  console.log(
    "[sync-omdb-ratings] buscando OMDb",
    {
      tmdbId,
      mediaType,
      imdbId,
    }
  );

  let response: OmdbTitleResponse;

  try {
    response = await runPremiumApiQueued("omdb", () =>
      omdbFetch<OmdbTitleResponse>({
        imdbId,
      }),
    );
  } catch (error) {
    console.warn(
      `[sync-omdb-ratings] OMDb falhou para ${imdbId}:`,
      error instanceof Error ? error.message : error
    );

    await completePremiumApiBudget(
      budget.reservation,
      "failed",
      error instanceof Error ? error.message : String(error),
    );

    logApiCall({
      api: "omdb",
      op: "sync-ratings",
      mediaType,
      tmdbId,
      endpoint: imdbId,
      cacheStatus: "failed",
      durationMs: Date.now() - t0,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });

    // Fallback: tentar Balloonerismm como fonte de rating IMDb-first.
    const ballRatings = await catalogGetRatings({ mediaType, imdbId }).catch(() => null);
    if (ballRatings?.rating) {
      const score = computePoplogScore({ imdb: ballRatings.rating, tmdb: input.tmdbRating });
      await upsertRatings({
        tmdbId,
        mediaType,
        imdbRating: ballRatings.rating,
        imdbVotes: ballRatings.votes ?? null,
        tmdbRating: input.tmdbRating ?? cached?.tmdb_rating ?? null,
        poplogScore: score?.score ?? null,
      }).catch(() => {});
      logApiCall({ api: "balloonerismm", op: "ratings-fallback", endpoint: imdbId, durationMs: Date.now() - t0, cacheStatus: "miss", success: true });
      return { source: "balloonerismm", cache_status: "stale_refreshed", ratings: await getCachedRatings(mediaType, tmdbId) };
    }

    // Toca updated_at para ativar cooldown de 1 dia e evitar burn loop.
    await upsertRatings({
      tmdbId,
      mediaType,
      imdbRating: cached?.imdb_rating ?? null,
      imdbVotes: cached?.imdb_votes ?? null,
      rottenTomatoesScore: cached?.rotten_tomatoes_score ?? null,
      metacriticScore: cached?.metacritic_score ?? null,
      tmdbRating: input.tmdbRating ?? cached?.tmdb_rating ?? null,
      poplogScore: cached?.poplog_score ?? null,
    }).catch(() => {});

    return {
      source: "cache",
      cache_status: "omdb_failed",
      ratings: cached,
    };
  }

  if (response.Response === "False") {
    console.warn(
      `[sync-omdb-ratings] OMDb retornou False para ${imdbId}: ${response.Error ?? ""}`
    );

    await completePremiumApiBudget(
      budget.reservation,
      "empty",
      response.Error ?? "Response=False",
    );

    logApiCall({
      api: "omdb",
      op: "sync-ratings",
      mediaType,
      tmdbId,
      endpoint: imdbId,
      cacheStatus: "failed",
      durationMs: Date.now() - t0,
      success: false,
      error: response.Error ?? "Response=False",
    });

    // Fallback: tentar Balloonerismm quando OMDb não conhece o título.
    const ballRatings = await catalogGetRatings({ mediaType, imdbId }).catch(() => null);
    if (ballRatings?.rating) {
      const score = computePoplogScore({ imdb: ballRatings.rating, tmdb: input.tmdbRating });
      await upsertRatings({
        tmdbId,
        mediaType,
        imdbRating: ballRatings.rating,
        imdbVotes: ballRatings.votes ?? null,
        tmdbRating: input.tmdbRating ?? cached?.tmdb_rating ?? null,
        poplogScore: score?.score ?? null,
      }).catch(() => {});
      logApiCall({ api: "balloonerismm", op: "ratings-fallback", endpoint: imdbId, durationMs: Date.now() - t0, cacheStatus: "miss", success: true });
      return { source: "balloonerismm", cache_status: "stale_refreshed", ratings: await getCachedRatings(mediaType, tmdbId) };
    }

    // Idem: toca updated_at para não tentar de novo hoje.
    await upsertRatings({
      tmdbId,
      mediaType,
      imdbRating: cached?.imdb_rating ?? null,
      imdbVotes: cached?.imdb_votes ?? null,
      rottenTomatoesScore: cached?.rotten_tomatoes_score ?? null,
      metacriticScore: cached?.metacritic_score ?? null,
      tmdbRating: input.tmdbRating ?? cached?.tmdb_rating ?? null,
      poplogScore: cached?.poplog_score ?? null,
    }).catch(() => {});

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

  logApiCall({
    api: "omdb",
    op: "sync-ratings",
    mediaType,
    tmdbId,
    endpoint: imdbId,
    cacheStatus: input.force ? "forced" : "miss",
    durationMs: Date.now() - t0,
    success: true,
  });

  await completePremiumApiBudget(budget.reservation, "success");

  return {
    source: "omdb",
    cache_status,
    ratings: next,
  };
}

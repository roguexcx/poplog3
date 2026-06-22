import { db } from "@/server/db/client";
import type { ContinuityStateRow } from "@/server/continuity/continuity-state-cache";
import type { EpisodeRuntimeInput } from "@/lib/runtime";
import {
  isSyntheticTmdbId,
  imdbIdFromSyntheticTmdbId,
} from "@/lib/ids/synthetic-tmdb-id";
import { isTechnicalIdLike } from "@/lib/titles/display-title";
import { recoverTitleFromRowSync } from "@/server/titles/recover-canonical-title";
import {
  upsertCachedTitleRow,
  computeBulkSeriesProgress,
  upsertUserTitleState,
} from "@/server/repositories";

// ── Public types ───────────────────────────────────────────────────────────────

export type LocalTitleData = {
  poplogId?: string | number | null;
  tmdb_id: number;
  media_type: "tv" | "movie";
  externalIds?: {
    tmdbId?: number;
    imdbId?: string;
    tvdbId?: string;
    traktId?: string;
    balloonerismmId?: string;
  };
  identityUsed?: string;
  linkIdUsed?: string | number;
  title: string | null;
  original_title: string | null;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  first_air_date: string | null;
  last_air_date: string | null;
  runtime: number | null;
  episode_run_time: number[] | null;
  genres: Array<{ id?: number; name?: string }> | null;
  popularity: number | null;
  vote_average: number | null;
  vote_count: number | null;
  number_of_episodes: number | null;
  number_of_seasons: number | null;
  last_synced_at: string | null;
};

export type LocalSeasonData = {
  series_tmdb_id: number;
  season_number: number;
  episode_count: number | null;
  last_synced_at: string | null;
};

export type LocalEpisodeData = {
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
  name: string | null;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
};

export type LocalUserEpisodeData = {
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
  watched_at: string;
};

export type LocalTitleRatingData = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  imdb_rating: number | null;
  imdb_votes: number | null;
  rotten_tomatoes_score: number | null;
  metacritic_score: number | null;
  poplog_score: number | null;
  source_payload: Record<string, unknown> | null;
};

/**
 * @deprecated Formato da tabela LEGADA `poplog3_title_availability`. A disponibilidade
 * canônica agora vem de `getTitleAvailability`/`hydrateManyTitleAvailability`
 * (catalog_availability). Mantido apenas até a remoção da tabela legada.
 */
export type LocalAvailabilityData = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  provider_name: string;
  provider_logo_path: string | null;
  availability_type: string;
  tmdb_provider_id: number | null;
};

export type LocalAgendaStateData = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  status: string | null;
  computed_state: string | null;
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;
};

// ── Converters ─────────────────────────────────────────────────────────────────

function dateToStr(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function jsonToNumberArray(val: unknown): number[] | null {
  if (!val || !Array.isArray(val)) return null;
  return val.filter((v): v is number => typeof v === "number");
}

function jsonToGenres(val: unknown): Array<{ id?: number; name?: string }> | null {
  if (!val || !Array.isArray(val)) return null;
  return val as Array<{ id?: number; name?: string }>;
}

function jsonToRecord(val: unknown): Record<string, unknown> | null {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return null;
}

function externalKey(mediaType: string, tmdbId: number) {
  return `${mediaType}:${tmdbId}`;
}

function buildExternalIdentity(row: {
  tmdbId: number;
  imdbId: string | null;
  tvdbId: string | null;
  traktId: string | null;
} | null) {
  if (!row) return { tmdbId: undefined };
  return {
    tmdbId: row.tmdbId,
    ...(row.imdbId ? { imdbId: row.imdbId, balloonerismmId: row.imdbId } : {}),
    ...(row.tvdbId ? { tvdbId: row.tvdbId } : {}),
    ...(row.traktId ? { traktId: row.traktId } : {}),
  };
}

// ── State rows ─────────────────────────────────────────────────────────────────

// Per-user debounce: avoid re-syncing stale states more than once every 3 minutes.
const staleSyncDebounce = new Map<string, number>();
const STALE_SYNC_DEBOUNCE_MS = 3 * 60 * 1000;

function mapStateRow(row: {
  tmdbId: number;
  mediaType: string;
  status: string | null;
  computedState: string | null;
  watchedEpisodes: number;
  airedEpisodes: number;
  totalEpisodes: number | null;
  progressPct: number;
  nextSeason: number | null;
  nextEpisode: number | null;
  nextEpisodeAirDate: Date | null;
  lastWatchedAt: Date | null;
  watchedKeys: unknown;
  bestProviderName: string | null;
  bestProviderType: string | null;
  bestProviderLogo: string | null;
  lastEventAt: Date;
}): ContinuityStateRow {
  return {
    tmdb_id: row.tmdbId,
    media_type: row.mediaType as "tv" | "movie",
    status: row.status as string | null,
    computed_state: row.computedState as string | null,
    watched_episodes: row.watchedEpisodes,
    aired_episodes: row.airedEpisodes,
    total_episodes: row.totalEpisodes,
    progress_pct: row.progressPct,
    next_season: row.nextSeason,
    next_episode: row.nextEpisode,
    next_episode_air_date: row.nextEpisodeAirDate
      ? row.nextEpisodeAirDate.toISOString().slice(0, 10)
      : null,
    last_watched_at: row.lastWatchedAt ? row.lastWatchedAt.toISOString() : null,
    watched_keys: Array.isArray(row.watchedKeys) ? (row.watchedKeys as string[]) : [],
    best_provider_name: row.bestProviderName,
    best_provider_type: row.bestProviderType,
    best_provider_logo: row.bestProviderLogo,
    last_event_at: row.lastEventAt.toISOString(),
  };
}

function deriveComputedStateFromProgress(
  status: string | null,
  watchedCount: number,
  airedEpisodes: number,
): string {
  if (!status) return "watchlist";
  if (status === "watched") return "completed";
  if (status === "abandoned" || status === "fridge" || status === "watchlist") return status;
  if (watchedCount === 0) return "watchlist";
  return watchedCount >= airedEpisodes && airedEpisodes > 0 ? "up_to_date" : "in_progress";
}

/**
 * Detects series where the episode catalog has more aired episodes than what's
 * cached in user_title_state, then recomputes and persists fresh progress.
 * Only runs for "watching" TV series that are "up_to_date" or "in_progress".
 * Returns the IDs of series that were updated.
 */
async function syncStaleEpisodeStates(
  userId: string,
  rows: ContinuityStateRow[],
): Promise<number[]> {
  // Only check series where new aired episodes could change the state
  const candidates = rows.filter(
    (r) =>
      r.media_type === "tv" &&
      r.status === "watching" &&
      (r.computed_state === "up_to_date" || r.computed_state === "in_progress"),
  );
  if (candidates.length === 0) return [];

  const candidateIds = candidates.map((r) => r.tmdb_id);

  // Quick staleness check: count currently-aired episodes per series from catalog
  const now = new Date();
  const airedCounts = await db.poplog3Episode.groupBy({
    by: ["seriesTmdbId"],
    where: {
      seriesTmdbId: { in: candidateIds },
      seasonNumber: { gt: 0 },
      airDate: { not: null, lte: now },
    },
    _count: { episodeNumber: true },
  });

  const freshAiredMap = new Map(airedCounts.map((r) => [r.seriesTmdbId, r._count.episodeNumber]));

  // Which series have more aired episodes than what's cached?
  const staleIds = candidates
    .filter((r) => {
      const freshAired = freshAiredMap.get(r.tmdb_id) ?? 0;
      return freshAired > (r.aired_episodes ?? 0);
    })
    .map((r) => r.tmdb_id);

  if (staleIds.length === 0) return [];

  // Full recompute for stale series
  const bulkResult = await computeBulkSeriesProgress({ userId, seriesTmdbIds: staleIds });
  if (!bulkResult.ok) {
    console.error("[continuity-local] bulk progress recompute failed", bulkResult.error);
    return [];
  }

  const staleRowMap = new Map(candidates.filter((r) => staleIds.includes(r.tmdb_id)).map((r) => [r.tmdb_id, r]));
  const updated: number[] = [];

  await Promise.allSettled(
    staleIds.map(async (seriesId) => {
      const progress = bulkResult.data.get(seriesId);
      if (!progress) return;
      const cached = staleRowMap.get(seriesId);
      if (!cached) return;

      const computedState = deriveComputedStateFromProgress(
        cached.status,
        progress.watchedCount,
        progress.airedEpisodes,
      );
      const progressPct =
        progress.airedEpisodes > 0
          ? Math.min(Math.round((progress.watchedCount / progress.airedEpisodes) * 100), 100)
          : 0;

      const result = await upsertUserTitleState({
        userId,
        tmdbId: seriesId,
        mediaType: "tv",
        status: cached.status as "watching" | "watchlist" | "watched" | "abandoned" | "fridge" | null,
        computedState: computedState as "in_progress" | "up_to_date" | "watchlist" | "completed" | "watched" | "abandoned" | "fridge" | null,
        watchedEpisodes: progress.watchedCount,
        airedEpisodes: progress.airedEpisodes,
        totalEpisodes: progress.totalEpisodes,
        progressPct,
        nextSeason: progress.nextEpisode?.seasonNumber ?? null,
        nextEpisode: progress.nextEpisode?.episodeNumber ?? null,
        nextEpisodeAirDate: progress.nextEpisode?.airDate ?? null,
        lastWatchedAt: progress.lastWatchedAt,
        watchedKeys: progress.watchedKeys,
        // Preserva o best_provider_* já materializado: o recompute de episódios
        // não recalcula disponibilidade, então omiti-lo apagaria o badge do provider.
        bestProviderName: cached.best_provider_name,
        bestProviderType: cached.best_provider_type,
        bestProviderLogo: cached.best_provider_logo,
      });

      if (result.ok) updated.push(seriesId);
    }),
  );

  if (updated.length > 0) {
    console.log(`[continuity-local] synced ${updated.length} stale episode state(s) for user ${userId}`);
  }
  return updated;
}

export async function getLocalContinuityStateRows(
  userId: string,
): Promise<ContinuityStateRow[]> {
  try {
    const rows = await db.userTitleState.findMany({
      where: { userId },
      orderBy: { lastEventAt: "desc" },
      take: 500,
    });
    const mapped = rows.map(mapStateRow);

    // Detect and fix stale episode counts (new aired episodes not yet reflected in user_title_state).
    // Debounced per user to avoid hammering on rapid consecutive requests.
    const lastSync = staleSyncDebounce.get(userId) ?? 0;
    if (Date.now() - lastSync > STALE_SYNC_DEBOUNCE_MS) {
      staleSyncDebounce.set(userId, Date.now());
      const updated = await syncStaleEpisodeStates(userId, mapped);
      if (updated.length > 0) {
        // Re-read with fresh data so the current request sees updated states
        const freshRows = await db.userTitleState.findMany({
          where: { userId },
          orderBy: { lastEventAt: "desc" },
          take: 500,
        });
        return freshRows.map(mapStateRow);
      }
    }

    return mapped;
  } catch (err) {
    console.error("[continuity-local] getLocalContinuityStateRows error", err);
    return [];
  }
}

// ── Title metadata ─────────────────────────────────────────────────────────────

export async function getLocalTitlesBatch(
  tmdbIds: number[],
  mediaType?: "tv" | "movie",
): Promise<LocalTitleData[]> {
  if (tmdbIds.length === 0) return [];
  try {
    const rows = await db.poplog3Title.findMany({
      where: {
        tmdbId: { in: tmdbIds },
        ...(mediaType ? { mediaType } : {}),
      },
    });
    const externalRows = await db.titleExternalId.findMany({
      where: {
        tmdbId: { in: rows.map((row) => row.tmdbId) },
        ...(mediaType ? { mediaType } : {}),
      },
      select: {
        tmdbId: true,
        mediaType: true,
        imdbId: true,
        tvdbId: true,
        traktId: true,
      },
    });
    const externalByKey = new Map(
      externalRows.map((row) => [externalKey(row.mediaType, row.tmdbId), row]),
    );
    return rows.map((row) => {
      const ext = externalByKey.get(externalKey(row.mediaType, row.tmdbId)) ?? null;
      // Recuperação canônica LOCAL (sem rede): se o `title` for técnico/vazio,
      // tenta payload/originalTitle antes de devolver — assim a UI nunca recebe
      // um ID, e a hidratação em background trata o que sobrar.
      const recovered = recoverTitleFromRowSync({
        id: row.id,
        tmdbId: row.tmdbId,
        imdbId: row.imdbId ?? ext?.imdbId ?? null,
        traktId: row.traktId ?? ext?.traktId ?? null,
        slug: row.slug,
        mediaType: row.mediaType as "tv" | "movie",
        title: row.title,
        originalTitle: row.originalTitle,
        tmdbPayload: row.tmdbPayload,
        sourcePayload: row.sourcePayload,
      });
      return {
      poplogId: row.id,
      tmdb_id: row.tmdbId,
      media_type: row.mediaType as "tv" | "movie",
      externalIds: buildExternalIdentity(ext),
      identityUsed: ext?.imdbId ? "imdb_id" : "poplog_id",
      linkIdUsed: ext?.imdbId ?? row.id,
      title: recovered.title ?? row.title,
      original_title: row.originalTitle,
      overview: row.overview,
      poster_path: row.posterPath,
      backdrop_path: row.backdropPath,
      release_date: dateToStr(row.releaseDate),
      first_air_date: dateToStr(row.firstAirDate),
      last_air_date: dateToStr(row.lastAirDate),
      runtime: row.runtime,
      episode_run_time: jsonToNumberArray(row.episodeRunTime),
      genres: jsonToGenres(row.genres),
      popularity: row.popularity !== null ? Number(row.popularity) : null,
      vote_average: row.voteAverage !== null ? Number(row.voteAverage) : null,
      vote_count: row.voteCount,
      number_of_episodes: row.numberOfEpisodes,
      number_of_seasons: row.numberOfSeasons,
      last_synced_at: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
      };
    });
  } catch (err) {
    console.error("[continuity-local] getLocalTitlesBatch error", err);
    return [];
  }
}

// ── Season metadata ────────────────────────────────────────────────────────────

export async function getLocalSeasonsBatch(
  seriesTmdbIds: number[],
): Promise<LocalSeasonData[]> {
  if (seriesTmdbIds.length === 0) return [];
  try {
    const rows = await db.titleSeason.findMany({
      where: { seriesTmdbId: { in: seriesTmdbIds } },
    });
    return rows.map((row) => ({
      series_tmdb_id: row.seriesTmdbId,
      season_number: row.seasonNumber,
      episode_count: row.episodeCount,
      last_synced_at: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    }));
  } catch (err) {
    console.error("[continuity-local] getLocalSeasonsBatch error", err);
    return [];
  }
}

// ── Episode metadata ───────────────────────────────────────────────────────────

export async function getLocalEpisodesBatch(
  seriesTmdbIds: number[],
): Promise<LocalEpisodeData[]> {
  if (seriesTmdbIds.length === 0) return [];
  try {
    const rows = await db.poplog3Episode.findMany({
      where: { seriesTmdbId: { in: seriesTmdbIds } },
    });
    return rows.map((row) => ({
      series_tmdb_id: row.seriesTmdbId,
      season_number: row.seasonNumber,
      episode_number: row.episodeNumber,
      name: row.name,
      still_path: row.stillPath,
      air_date: dateToStr(row.airDate),
      runtime: row.runtime,
    }));
  } catch (err) {
    console.error("[continuity-local] getLocalEpisodesBatch error", err);
    return [];
  }
}

// ── Episode runtime map (for watchlist-picks) ──────────────────────────────────

export async function getLocalEpisodeRuntimesMap(
  tvIds: number[],
): Promise<Map<number, EpisodeRuntimeInput[]>> {
  const map = new Map<number, EpisodeRuntimeInput[]>();
  if (tvIds.length === 0) return map;
  try {
    const rows = await db.poplog3Episode.findMany({
      where: { seriesTmdbId: { in: tvIds }, runtime: { not: null } },
      select: { seriesTmdbId: true, seasonNumber: true, episodeNumber: true, runtime: true, airDate: true },
    });
    for (const row of rows) {
      const list = map.get(row.seriesTmdbId) ?? [];
      list.push({
        seasonNumber: row.seasonNumber,
        episodeNumber: row.episodeNumber,
        runtimeMinutes: row.runtime,
        airDate: dateToStr(row.airDate),
      });
      map.set(row.seriesTmdbId, list);
    }
  } catch (err) {
    console.error("[continuity-local] getLocalEpisodeRuntimesMap error", err);
  }
  return map;
}

// ── User episode history ───────────────────────────────────────────────────────

export async function getLocalUserEpisodesBatch(
  userId: string,
  seriesTmdbIds: number[],
): Promise<LocalUserEpisodeData[]> {
  if (seriesTmdbIds.length === 0) return [];
  try {
    const rows = await db.userEpisode.findMany({
      where: { userId, seriesTmdbId: { in: seriesTmdbIds } },
      orderBy: { watchedAt: "desc" },
      take: seriesTmdbIds.length * 10,
    });
    return rows.map((row) => ({
      series_tmdb_id: row.seriesTmdbId,
      season_number: row.seasonNumber,
      episode_number: row.episodeNumber,
      watched_at: row.watchedAt.toISOString(),
    }));
  } catch (err) {
    console.error("[continuity-local] getLocalUserEpisodesBatch error", err);
    return [];
  }
}

// ── Title ratings ──────────────────────────────────────────────────────────────

export async function getLocalTitleRatingsBatch(
  tmdbIds: number[],
): Promise<LocalTitleRatingData[]> {
  if (tmdbIds.length === 0) return [];
  try {
    const rows = await db.titleRating.findMany({
      where: { tmdbId: { in: tmdbIds } },
    });
    return rows.map((row) => ({
      tmdb_id: row.tmdbId,
      media_type: row.mediaType as "movie" | "tv",
      imdb_rating: row.imdbRating !== null ? Number(row.imdbRating) : null,
      imdb_votes: row.imdbVotes,
      rotten_tomatoes_score: row.rottenTomatoesScore,
      metacritic_score: row.metacriticScore,
      poplog_score: row.poplogScore !== null ? Number(row.poplogScore) : null,
      source_payload: jsonToRecord(row.sourcePayload),
    }));
  } catch (err) {
    console.error("[continuity-local] getLocalTitleRatingsBatch error", err);
    return [];
  }
}

// ── User library ids (for agenda) ─────────────────────────────────────────────

export async function getLocalUserLibraryIds(userId: string): Promise<Record<string, string>> {
  try {
    const rows = await db.userTitle.findMany({
      where: { userId },
      select: { tmdbId: true, mediaType: true, status: true },
    });
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[`${row.mediaType}-${row.tmdbId}`] = row.status;
    }
    return result;
  } catch (err) {
    console.error("[continuity-local] getLocalUserLibraryIds error", err);
    return {};
  }
}

// ── Library tmdb_ids (for radar personal filter) ───────────────────────────────

export async function getLocalUserLibraryTmdbIds(userId: string): Promise<{
  tvIds: Set<number>;
  movieIds: Set<number>;
}> {
  try {
    const rows = await db.userTitleState.findMany({
      where: { userId, status: { in: ["watching", "watchlist", "watched"] } },
      select: { tmdbId: true, mediaType: true },
    });
    const tvIds = new Set<number>();
    const movieIds = new Set<number>();
    for (const row of rows) {
      if (row.mediaType === "tv") tvIds.add(row.tmdbId);
      else if (row.mediaType === "movie") movieIds.add(row.tmdbId);
    }
    console.log(
      `[continuity-local] local library: ${tvIds.size} tv, ${movieIds.size} movie (userId=${userId})`,
    );
    return { tvIds, movieIds };
  } catch (err) {
    console.error("[continuity-local] getLocalUserLibraryTmdbIds error", err);
    return { tvIds: new Set<number>(), movieIds: new Set<number>() };
  }
}

// ── Availability (LEGADO — DEPRECATED) ────────────────────────────────────────

/**
 * @deprecated NÃO USAR. Lê a tabela legada `poplog3_title_availability`, que NÃO é mais
 * escrita pelo código atual. A Agenda (último consumidor) foi migrada para o fluxo
 * canônico `hydrateManyTitleAvailability(cacheOnly:true, warmCold:true)`. Esta função
 * está sem chamadores e será REMOVIDA junto com a tabela `poplog3_title_availability`.
 * Para disponibilidade, use SEMPRE `getTitleAvailability`/`hydrateManyTitleAvailability`.
 */
export async function getLocalTitleAvailabilityBatch(
  movieIds: number[],
  tvIds: number[],
  country: string,
): Promise<LocalAvailabilityData[]> {
  const results: LocalAvailabilityData[] = [];
  try {
    if (movieIds.length > 0) {
      const rows = await db.poplog3TitleAvailability.findMany({
        where: { mediaType: "movie", country, tmdbId: { in: movieIds } },
      });
      for (const row of rows) {
        results.push({
          tmdb_id: row.tmdbId,
          media_type: "movie",
          provider_name: row.providerName,
          provider_logo_path: row.providerLogoPath,
          availability_type: String(row.availabilityType),
          tmdb_provider_id: row.tmdbProviderId,
        });
      }
    }
    if (tvIds.length > 0) {
      const rows = await db.poplog3TitleAvailability.findMany({
        where: { mediaType: "tv", country, tmdbId: { in: tvIds } },
      });
      for (const row of rows) {
        results.push({
          tmdb_id: row.tmdbId,
          media_type: "tv",
          provider_name: row.providerName,
          provider_logo_path: row.providerLogoPath,
          availability_type: String(row.availabilityType),
          tmdb_provider_id: row.tmdbProviderId,
        });
      }
    }
  } catch (err) {
    console.error("[continuity-local] getLocalTitleAvailabilityBatch error", err);
  }
  return results;
}

// ── Synthetic ID enrichment ───────────────────────────────────────────────────

/**
 * Para IDs sintéticos negativos ausentes no DB: busca dados via Balloonerismm,
 * persiste em poplog3Title e retorna como LocalTitleData.
 *
 * Uso: pós-processamento após getLocalTitlesBatch para garantir que títulos
 * IMDb-first apareçam na Biblioteca e no Acompanhando.
 */
export async function enrichSyntheticTitlesBatch(
  missingIds: number[],
  mediaType: "tv" | "movie",
): Promise<LocalTitleData[]> {
  const synthetic = missingIds.filter((id) => isSyntheticTmdbId(id));
  if (synthetic.length === 0) return [];

  const { getPoplogTitleDetails } = await import("@/server/titles/poplog-title-details");

  const results: LocalTitleData[] = [];

  await Promise.allSettled(
    synthetic.map(async (syntheticTmdbId) => {
      const imdbId = imdbIdFromSyntheticTmdbId(syntheticTmdbId);
      if (!imdbId) return;

      const details = await getPoplogTitleDetails({ mediaType, id: imdbId, sourceHint: "imdb" }).catch(() => null);
      if (!details?.title) return;

      await upsertCachedTitleRow({
        tmdbId: syntheticTmdbId,
        mediaType,
        title: details.title,
        originalTitle: details.originalTitle ?? null,
        overview: details.overview ?? null,
        posterPath: details.posterUrl ?? null,
        backdropPath: details.backdropUrl ?? null,
        year: details.year ?? null,
        runtime: details.runtime ?? null,
        voteAverage: details.voteAverage ?? null,
        voteCount: details.voteCount ?? null,
        numberOfSeasons: details.numberOfSeasons ?? null,
        numberOfEpisodes: details.numberOfEpisodes ?? null,
        releaseDate: mediaType === "movie" ? (details.releaseDate ?? null) : null,
        firstAirDate: mediaType === "tv" ? (details.releaseDate ?? null) : null,
        lastAirDate: details.lastAirDate ?? null,
      }).catch(() => {});

      results.push({
        poplogId: null,
        tmdb_id: syntheticTmdbId,
        media_type: mediaType,
        externalIds: {
          tmdbId: syntheticTmdbId,
          imdbId,
          balloonerismmId: imdbId,
        },
        identityUsed: "imdb_id",
        linkIdUsed: imdbId,
        title: details.title,
        original_title: details.originalTitle ?? null,
        overview: details.overview ?? null,
        poster_path: details.posterUrl ?? null,
        backdrop_path: details.backdropUrl ?? null,
        release_date: mediaType === "movie" ? (details.releaseDate ?? null) : null,
        first_air_date: mediaType === "tv" ? (details.releaseDate ?? null) : null,
        last_air_date: details.lastAirDate ?? null,
        runtime: details.runtime ?? null,
        episode_run_time: null,
        genres: null,
        popularity: null,
        vote_average: details.voteAverage ?? null,
        vote_count: details.voteCount ?? null,
        number_of_episodes: details.numberOfEpisodes ?? null,
        number_of_seasons: details.numberOfSeasons ?? null,
        last_synced_at: null,
      });
    }),
  );

  return results;
}

/**
 * Re-enriches real (positive) tmdbIds that exist in the DB but have a null title.
 * Looks up their imdbId from the titleMap and fetches from Balloonerismm.
 * Updates the DB row so subsequent requests don't need to re-enrich.
 */
export async function enrichNullTitlesBatch(
  tmdbIds: number[],
  mediaType: "tv" | "movie",
  titleMap: Map<number, LocalTitleData>,
): Promise<LocalTitleData[]> {
  const candidates = tmdbIds.filter((id) => {
    const t = titleMap.get(id);
    if (!t || id <= 0 || typeof t.externalIds?.imdbId !== "string") return false;
    // Re-hidrata quando o título está vazio OU é um ID técnico (tt..., etc.).
    return isTechnicalIdLike(t.title, {
      tmdbId: id,
      imdbId: t.externalIds?.imdbId,
      traktId: t.externalIds?.traktId ?? null,
      poplogId: t.poplogId,
    });
  });
  if (candidates.length === 0) return [];

  const { getPoplogTitleDetails } = await import("@/server/titles/poplog-title-details");
  const results: LocalTitleData[] = [];

  await Promise.allSettled(
    candidates.map(async (tmdbId) => {
      const existing = titleMap.get(tmdbId)!;
      const imdbId = existing.externalIds?.imdbId as string;

      const details = await getPoplogTitleDetails({ mediaType, id: imdbId, sourceHint: "imdb" }).catch(() => null);
      if (!details?.title) return;

      await upsertCachedTitleRow({
        tmdbId,
        mediaType,
        title: details.title,
        originalTitle: details.originalTitle ?? null,
        overview: details.overview ?? null,
        posterPath: details.posterUrl ?? null,
        backdropPath: details.backdropUrl ?? null,
        year: details.year ?? null,
        runtime: details.runtime ?? null,
        voteAverage: details.voteAverage ?? null,
        voteCount: details.voteCount ?? null,
        numberOfSeasons: details.numberOfSeasons ?? null,
        numberOfEpisodes: details.numberOfEpisodes ?? null,
        releaseDate: mediaType === "movie" ? (details.releaseDate ?? null) : null,
        firstAirDate: mediaType === "tv" ? (details.releaseDate ?? null) : null,
        lastAirDate: details.lastAirDate ?? null,
      }).catch(() => {});

      results.push({
        ...existing,
        title: details.title,
        original_title: details.originalTitle ?? existing.original_title,
        overview: details.overview ?? existing.overview,
        poster_path: details.posterUrl ?? existing.poster_path,
        backdrop_path: details.backdropUrl ?? existing.backdrop_path,
      });
    }),
  );

  return results;
}

// ── User state for agenda enrichment ──────────────────────────────────────────

export async function getLocalAgendaStateBatch(
  userId: string,
  movieIds: number[],
  tvIds: number[],
): Promise<LocalAgendaStateData[]> {
  const results: LocalAgendaStateData[] = [];
  try {
    const ids = [...movieIds, ...tvIds];
    if (ids.length === 0) return results;
    const rows = await db.userTitleState.findMany({
      where: { userId, tmdbId: { in: ids } },
      select: {
        tmdbId: true,
        mediaType: true,
        status: true,
        computedState: true,
        bestProviderName: true,
        bestProviderType: true,
        bestProviderLogo: true,
      },
    });
    for (const row of rows) {
      results.push({
        tmdb_id: row.tmdbId,
        media_type: row.mediaType as "movie" | "tv",
        status: row.status as string | null,
        computed_state: row.computedState as string | null,
        best_provider_name: row.bestProviderName,
        best_provider_type: row.bestProviderType,
        best_provider_logo: row.bestProviderLogo,
      });
    }
  } catch (err) {
    console.error("[continuity-local] getLocalAgendaStateBatch error", err);
  }
  return results;
}

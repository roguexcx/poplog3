import { db } from "@/server/db/client";
import type { ContinuityStateRow } from "@/server/continuity/continuity-state-cache";
import type { EpisodeRuntimeInput } from "@/lib/runtime";
import {
  isSyntheticTmdbId,
  imdbIdFromSyntheticTmdbId,
} from "@/lib/ids/synthetic-tmdb-id";
import {
  upsertCachedTitleRow,
} from "@/server/repositories";

// ── Public types ───────────────────────────────────────────────────────────────

export type LocalTitleData = {
  tmdb_id: number;
  media_type: "tv" | "movie";
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

// ── State rows ─────────────────────────────────────────────────────────────────

export async function getLocalContinuityStateRows(
  userId: string,
): Promise<ContinuityStateRow[]> {
  try {
    const rows = await db.userTitleState.findMany({
      where: { userId },
      orderBy: { lastEventAt: "desc" },
      take: 500,
    });
    return rows.map((row) => ({
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
    }));
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
    return rows.map((row) => ({
      tmdb_id: row.tmdbId,
      media_type: row.mediaType as "tv" | "movie",
      title: row.title,
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
    }));
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

// ── Availability (for agenda enrichment) ──────────────────────────────────────

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
        tmdb_id: syntheticTmdbId,
        media_type: mediaType,
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

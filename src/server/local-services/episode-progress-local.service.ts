import {
  clearSeasonProgress as clearSeasonProgressRows,
  clearSeriesProgress as clearSeriesProgressRows,
  computeUserSeriesProgress as computeProgress,
  createUserEvent,
  deleteWatchedEpisode,
  getWatchedEpisodesForSeries as getWatchedRows,
  getUserTitle,
  upsertUserTitle,
  upsertUserTitleState,
  upsertWatchedEpisode,
} from "@/server/repositories";
import { db } from "@/server/db/client";
import type { UserEpisode } from "@prisma/client";
import type { EpisodeKey, UserSeriesProgress } from "@/server/repositories/episode-progress.repository";
import type { Poplog3LibraryStatus } from "@/server/library/types";
import { hydrateSeriesEpisodesFromSources } from "@/server/source-engine/series-episode-hydrator";

export type { EpisodeKey, UserSeriesProgress };

export type UserEpisodeRow = {
  user_id: string;
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
  watched_at: string;
  runtime_minutes: number | null;
};

export type ToggleEpisodeInput = {
  userId: string;
  seriesTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  watched: boolean;
  runtimeMinutes?: number | null;
};

export type UserWatchingSeriesRow = UserSeriesProgress & {
  title: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  mediaStatus: string | null;
  inLibraryStatus: string | null;
};

function mapEpisode(row: UserEpisode): UserEpisodeRow {
  return {
    user_id: row.userId,
    series_tmdb_id: row.seriesTmdbId,
    season_number: row.seasonNumber,
    episode_number: row.episodeNumber,
    watched_at: row.watchedAt.toISOString(),
    runtime_minutes: row.runtimeMinutes,
  };
}

function episodeKey(season: number, episode: number): EpisodeKey {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}` as EpisodeKey;
}

function episodeAirDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function isValidAiredEpisode(row: {
  seasonNumber: number;
  episodeNumber: number;
  airDate: Date | null;
}, now = Date.now()) {
  return (
    row.seasonNumber > 0 &&
    row.episodeNumber > 0 &&
    row.airDate !== null &&
    Number.isFinite(row.airDate.getTime()) &&
    row.airDate.getTime() <= now
  );
}

function eventComputedState(progress: UserSeriesProgress) {
  if (progress.watchedCount === 0) return "watchlist";
  return progress.nextEpisode ? "in_progress" : "up_to_date";
}

async function readProgress(userId: string, seriesTmdbId: number): Promise<UserSeriesProgress> {
  const progress = await computeProgress({ userId, seriesTmdbId });
  if (!progress.ok) throw new Error(progress.error);
  return progress.data;
}

async function readLibraryEntry(userId: string, seriesTmdbId: number) {
  const result = await getUserTitle({
    userId,
    tmdbId: seriesTmdbId,
    mediaType: "tv",
  });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

async function syncState(input: {
  userId: string;
  seriesTmdbId: number;
  progress: UserSeriesProgress;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  const existing = await readLibraryEntry(input.userId, input.seriesTmdbId);
  const status: Poplog3LibraryStatus =
    existing?.status === "watched" || existing?.status === "watching"
      ? existing.status
      : "watching";

  await upsertUserTitle({
    userId: input.userId,
    tmdbId: input.seriesTmdbId,
    mediaType: "tv",
    status,
    favorite: existing?.favorite ?? false,
    liked: existing?.liked ?? null,
    rating: existing?.rating ?? null,
    notes: existing?.notes ?? null,
  });
  await upsertUserTitleState({
    userId: input.userId,
    tmdbId: input.seriesTmdbId,
    mediaType: "tv",
    status,
    favorite: existing?.favorite ?? false,
    liked: existing?.liked ?? null,
    computedState: status === "watched" ? "completed" : eventComputedState(input.progress),
    watchedEpisodes: input.progress.watchedCount,
    airedEpisodes: input.progress.airedEpisodes,
    totalEpisodes: input.progress.totalEpisodes,
    progressPct: input.progress.airedEpisodes > 0
      ? Math.min(Math.round((input.progress.watchedCount / input.progress.airedEpisodes) * 100), 100)
      : 0,
    nextSeason: input.progress.nextEpisode?.seasonNumber ?? null,
    nextEpisode: input.progress.nextEpisode?.episodeNumber ?? null,
    nextEpisodeAirDate: input.progress.nextEpisode?.airDate ?? null,
    lastWatchedAt: input.progress.lastWatchedAt,
    watchedKeys: input.progress.watchedKeys,
  });
  await createUserEvent({
    userId: input.userId,
    tmdbId: input.seriesTmdbId,
    mediaType: "tv",
    eventType: input.eventType,
    payload: input.payload ?? {},
  });
}

export async function bulkMarkEpisodesWatched(input: {
  userId: string;
  seriesTmdbId: number;
  episodes: Array<{
    seasonNumber: number;
    episodeNumber: number;
    runtimeMinutes?: number | null;
  }>;
  eventType?: "season_marked" | "episode_watched" | "series_completed";
}): Promise<UserSeriesProgress> {
  if (input.episodes.length === 0) {
    return readProgress(input.userId, input.seriesTmdbId);
  }

  const settled = await Promise.allSettled(
    input.episodes.map((episode) =>
      upsertWatchedEpisode({
        userId: input.userId,
        seriesTmdbId: input.seriesTmdbId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        runtimeMinutes: episode.runtimeMinutes ?? null,
      }),
    ),
  );

  for (const result of settled) {
    if (result.status === "rejected") {
      throw result.reason instanceof Error ? result.reason : new Error(String(result.reason));
    }
    if (!result.value.ok) throw new Error(result.value.error);
  }

  const progress = await readProgress(input.userId, input.seriesTmdbId);
  await syncState({
    userId: input.userId,
    seriesTmdbId: input.seriesTmdbId,
    progress,
    eventType: input.eventType ?? "season_marked",
    payload: { count: input.episodes.length },
  });
  return progress;
}

export async function toggleEpisodeWatched(input: ToggleEpisodeInput): Promise<UserSeriesProgress> {
  if (input.watched) {
    const result = await upsertWatchedEpisode({
      userId: input.userId,
      seriesTmdbId: input.seriesTmdbId,
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
      runtimeMinutes: input.runtimeMinutes ?? null,
    });
    if (!result.ok) throw new Error(result.error);
  } else {
    const result = await deleteWatchedEpisode({
      userId: input.userId,
      seriesTmdbId: input.seriesTmdbId,
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
    });
    if (!result.ok) throw new Error(result.error);
  }

  const progress = await readProgress(input.userId, input.seriesTmdbId);
  await syncState({
    userId: input.userId,
    seriesTmdbId: input.seriesTmdbId,
    progress,
    eventType: input.watched ? "episode_watched" : "episode_unwatched",
    payload: { season: input.seasonNumber, episode: input.episodeNumber },
  });
  return progress;
}

export async function markSeasonWatched(
  userId: string,
  seriesTmdbId: number,
  seasonNumber: number,
): Promise<UserSeriesProgress> {
  const now = Date.now();
  const episodes = await db.poplog3Episode.findMany({
    where: {
      seriesTmdbId,
      seasonNumber,
      airDate: { not: null },
    },
    orderBy: [{ episodeNumber: "asc" }],
  });

  return bulkMarkEpisodesWatched({
    userId,
    seriesTmdbId,
    episodes: episodes
      .filter((episode) => isValidAiredEpisode(episode, now))
      .map((episode) => ({
        seasonNumber,
        episodeNumber: episode.episodeNumber,
        runtimeMinutes: episode.runtime ?? null,
      })),
    eventType: "season_marked",
  });
}

export async function getWatchedEpisodesForSeries(
  userId: string,
  seriesTmdbId: number,
): Promise<UserEpisodeRow[]> {
  const result = await getWatchedRows({ userId, seriesTmdbId });
  if (!result.ok) throw new Error(result.error);
  return result.data.map(mapEpisode);
}

export async function getUserWatchingSeries(
  userId: string,
  limit = 50,
): Promise<UserWatchingSeriesRow[]> {
  const now = Date.now();
  const watched = await db.userEpisode.findMany({
    where: { userId },
    orderBy: { watchedAt: "desc" },
  });

  if (watched.length === 0) return [];

  const orderedIds: number[] = [];
  const seen = new Set<number>();
  for (const row of watched) {
    if (seen.has(row.seriesTmdbId)) continue;
    seen.add(row.seriesTmdbId);
    orderedIds.push(row.seriesTmdbId);
    if (orderedIds.length >= limit) break;
  }

  if (orderedIds.length === 0) return [];

  const [titles, userTitles, catalogEpisodes] = await Promise.all([
    db.poplog3Title.findMany({
      where: { mediaType: "tv", tmdbId: { in: orderedIds } },
    }),
    db.userTitle.findMany({
      where: { userId, mediaType: "tv", tmdbId: { in: orderedIds } },
    }),
    db.poplog3Episode.findMany({
      where: { seriesTmdbId: { in: orderedIds }, seasonNumber: { gt: 0 } },
      orderBy: [
        { seriesTmdbId: "asc" },
        { seasonNumber: "asc" },
        { episodeNumber: "asc" },
      ],
    }),
  ]);

  const titleMap = new Map(titles.map((title) => [title.tmdbId, title]));
  const userTitleMap = new Map(userTitles.map((title) => [title.tmdbId, title.status]));
  const catalogBySeries = new Map<number, typeof catalogEpisodes>();
  for (const episode of catalogEpisodes) {
    const list = catalogBySeries.get(episode.seriesTmdbId) ?? [];
    list.push(episode);
    catalogBySeries.set(episode.seriesTmdbId, list);
  }
  const watchedBySeries = new Map<number, typeof watched>();
  for (const row of watched) {
    if (!seen.has(row.seriesTmdbId)) continue;
    const list = watchedBySeries.get(row.seriesTmdbId) ?? [];
    list.push(row);
    watchedBySeries.set(row.seriesTmdbId, list);
  }

  return orderedIds.map((seriesId) => {
    const catalog = catalogBySeries.get(seriesId) ?? [];
    const watchedRows = watchedBySeries.get(seriesId) ?? [];
    const aired = catalog.filter((episode) => isValidAiredEpisode(episode, now));
    const validKeys = new Set(aired.map((episode) => `${episode.seasonNumber}-${episode.episodeNumber}`));
    const watchedValid = watchedRows.filter((row) =>
      validKeys.has(`${row.seasonNumber}-${row.episodeNumber}`),
    );
    const watchedKeys = new Set(watchedValid.map((row) => `${row.seasonNumber}-${row.episodeNumber}`));
    const next = aired.find((episode) => !watchedKeys.has(`${episode.seasonNumber}-${episode.episodeNumber}`));
    const lastWatchedAt = watchedValid.length > 0
      ? watchedValid
          .map((row) => row.watchedAt)
          .sort((a, b) => b.getTime() - a.getTime())[0]
          .toISOString()
      : null;
    const title = titleMap.get(seriesId) ?? null;
    const payload = title?.tmdbPayload;
    const mediaStatus =
      payload && typeof payload === "object" && "status" in payload
        ? String((payload as Record<string, unknown>).status ?? "") || null
        : null;

    return {
      seriesTmdbId: seriesId,
      watchedCount: watchedValid.length,
      totalEpisodes:
        title?.numberOfEpisodes && title.numberOfEpisodes > 0
          ? Math.max(title.numberOfEpisodes, catalog.filter((episode) => episode.airDate !== null).length)
          : catalog.filter((episode) => episode.airDate !== null).length || null,
      airedEpisodes: aired.length,
      lastWatchedAt,
      watchedKeys: watchedValid.map((row) => episodeKey(row.seasonNumber, row.episodeNumber)),
      nextEpisode: next
        ? {
            seasonNumber: next.seasonNumber,
            episodeNumber: next.episodeNumber,
            airDate: episodeAirDate(next.airDate),
          }
        : null,
      title: title?.title ?? null,
      posterPath: title?.posterPath ?? null,
      backdropPath: title?.backdropPath ?? null,
      mediaStatus,
      inLibraryStatus: userTitleMap.get(seriesId) ?? null,
    };
  });
}

export async function computeUserSeriesProgress(
  userId: string,
  seriesTmdbId: number,
): Promise<UserSeriesProgress> {
  return readProgress(userId, seriesTmdbId);
}

export async function clearSeasonProgress(
  userId: string,
  seriesTmdbId: number,
  seasonNumber: number,
): Promise<UserSeriesProgress> {
  const result = await clearSeasonProgressRows({ userId, seriesTmdbId, seasonNumber });
  if (!result.ok) throw new Error(result.error);
  const progress = await readProgress(userId, seriesTmdbId);
  await syncState({ userId, seriesTmdbId, progress, eventType: "season_unmarked", payload: { season: seasonNumber } });
  return progress;
}

export async function clearSeriesProgress(userId: string, seriesTmdbId: number): Promise<void> {
  const result = await clearSeriesProgressRows({ userId, seriesTmdbId });
  if (!result.ok) throw new Error(result.error);
  const progress = await readProgress(userId, seriesTmdbId);
  await syncState({ userId, seriesTmdbId, progress, eventType: "series_reset" });
}

export async function markAllAiredEpisodes(
  userId: string,
  seriesTmdbId: number,
): Promise<UserSeriesProgress> {
  const now = Date.now();
  let episodes = await db.poplog3Episode.findMany({
    where: {
      seriesTmdbId,
      seasonNumber: { gt: 0 },
    },
    orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
  });

  // Auto-hidratação: se DB está vazio, buscar de TVDB/Trakt/Balloonerismm
  if (episodes.length === 0) {
    const hydrated = await hydrateSeriesEpisodesFromSources({ seriesTmdbId });
    if (hydrated.episodesSaved > 0) {
      episodes = await db.poplog3Episode.findMany({
        where: { seriesTmdbId, seasonNumber: { gt: 0 } },
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
      });
    }
  }

  return bulkMarkEpisodesWatched({
    userId,
    seriesTmdbId,
    episodes: episodes
      .filter((episode) => isValidAiredEpisode(episode, now))
      .map((episode) => ({
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        runtimeMinutes: episode.runtime ?? null,
      })),
    eventType: "series_completed",
  });
}

export async function markEpisodesUntil(input: {
  userId: string;
  seriesTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
}): Promise<UserSeriesProgress> {
  const now = Date.now();
  const episodes = await db.poplog3Episode.findMany({
    where: {
      seriesTmdbId: input.seriesTmdbId,
      seasonNumber: { gt: 0 },
    },
    orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
  });

  return bulkMarkEpisodesWatched({
    userId: input.userId,
    seriesTmdbId: input.seriesTmdbId,
    episodes: episodes
      .filter((episode) => {
        if (!isValidAiredEpisode(episode, now)) return false;
        if (episode.seasonNumber < input.seasonNumber) return true;
        if (episode.seasonNumber > input.seasonNumber) return false;
        return episode.episodeNumber <= input.episodeNumber;
      })
      .map((episode) => ({
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        runtimeMinutes: episode.runtime ?? null,
      })),
    eventType: "episode_watched",
  });
}

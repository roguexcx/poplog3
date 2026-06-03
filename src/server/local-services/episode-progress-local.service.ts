import {
  clearSeasonProgress as clearSeasonProgressRows,
  clearSeriesProgress as clearSeriesProgressRows,
  computeUserSeriesProgress as computeProgress,
  createUserEvent,
  deleteWatchedEpisode,
  getWatchedEpisodesForSeries as getWatchedRows,
  upsertUserTitle,
  upsertUserTitleState,
  upsertWatchedEpisode,
} from "@/server/repositories";
import type { UserEpisode } from "@prisma/client";
import type { EpisodeKey, UserSeriesProgress } from "@/server/repositories/episode-progress.repository";

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

async function readProgress(userId: string, seriesTmdbId: number): Promise<UserSeriesProgress> {
  const progress = await computeProgress({ userId, seriesTmdbId });
  if (!progress.ok) throw new Error(progress.error);
  return progress.data;
}

async function syncState(input: {
  userId: string;
  seriesTmdbId: number;
  progress: UserSeriesProgress;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  await upsertUserTitle({
    userId: input.userId,
    tmdbId: input.seriesTmdbId,
    mediaType: "tv",
    status: "watching",
  });
  await upsertUserTitleState({
    userId: input.userId,
    tmdbId: input.seriesTmdbId,
    mediaType: "tv",
    status: "watching",
    computedState: input.progress.nextEpisode ? "in_progress" : "up_to_date",
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
    const result = await deleteWatchedEpisode(input);
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

export async function getWatchedEpisodesForSeries(
  userId: string,
  seriesTmdbId: number,
): Promise<UserEpisodeRow[]> {
  const result = await getWatchedRows({ userId, seriesTmdbId });
  if (!result.ok) throw new Error(result.error);
  return result.data.map(mapEpisode);
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

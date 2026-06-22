import {
  createUserEvent,
  deleteUserTitleState,
  listUserTitleStates,
  readUserTitleState,
  updateUserTitleStateAvailability,
  upsertUserTitleState,
  type UpsertUserTitleStateInput,
} from "@/server/repositories";
import type { ComputedState, LibraryStatus, MediaType, UserTitleState as PrismaUserTitleState } from "@prisma/client";
import { db } from "@/server/db/client";
import { computeUserSeriesProgress } from "@/server/repositories/episode-progress.repository";
import { calculateRemainingSeriesRuntime } from "@/server/library/runtime-calculator";

export type UserEventType =
  | "episode_watched"
  | "episode_unwatched"
  | "season_marked"
  | "season_unmarked"
  | "series_completed"
  | "series_reset"
  | "status_changed"
  | "movie_watched"
  | "franchise_updated"
  | "availability_synced"
  | "feedback_applied";

export type UserTitleState = {
  id: string;
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  status: string | null;
  favorite: boolean;
  liked: boolean | null;
  computed_state: ComputedState | null;
  watched_episodes: number;
  aired_episodes: number;
  total_episodes: number | null;
  progress_pct: number;
  next_season: number | null;
  next_episode: number | null;
  next_episode_air_date: string | null;
  last_watched_at: string | null;
  watched_keys: string[];
  franchise_tmdb_id: number | null;
  franchise_name: string | null;
  franchise_watched: number | null;
  franchise_total: number | null;
  duration_sort_minutes: number | null;
  duration_sort_unavailable: boolean;
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;
  last_event_at: string;
  created_at: string;
  updated_at: string;
};

export type UpsertTitleStateInput = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  seriesProgress?: {
    watchedCount: number;
    airedEpisodes: number;
    totalEpisodes: number | null;
    nextEpisode: { seasonNumber: number; episodeNumber: number; airDate: string | null } | null;
    lastWatchedAt: string | null;
    watchedKeys: string[];
  };
  libraryEntry?: {
    status: string | null;
    favorite?: boolean;
    liked?: boolean | null;
  };
  event?: {
    type: UserEventType;
    payload?: Record<string, unknown>;
  };
};

export type GetUserTitleStatesOptions = {
  mediaType?: MediaType;
  computedState?: ComputedState | ComputedState[];
  status?: LibraryStatus | LibraryStatus[];
  limit?: number;
};

function dateTime(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapState(row: PrismaUserTitleState): UserTitleState {
  return {
    id: row.id,
    user_id: row.userId,
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    status: row.status,
    favorite: row.favorite,
    liked: row.liked,
    computed_state: row.computedState,
    watched_episodes: row.watchedEpisodes,
    aired_episodes: row.airedEpisodes,
    total_episodes: row.totalEpisodes,
    progress_pct: row.progressPct,
    next_season: row.nextSeason,
    next_episode: row.nextEpisode,
    next_episode_air_date: dateTime(row.nextEpisodeAirDate)?.slice(0, 10) ?? null,
    last_watched_at: dateTime(row.lastWatchedAt),
    watched_keys: Array.isArray(row.watchedKeys) ? row.watchedKeys as string[] : [],
    franchise_tmdb_id: row.franchiseTmdbId,
    franchise_name: row.franchiseName,
    franchise_watched: row.franchiseWatched,
    franchise_total: row.franchiseTotal,
    duration_sort_minutes: row.durationSortMinutes,
    duration_sort_unavailable: row.durationSortUnavailable,
    best_provider_name: row.bestProviderName,
    best_provider_type: row.bestProviderType,
    best_provider_logo: row.bestProviderLogo,
    last_event_at: row.lastEventAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function deriveComputedState(mediaType: MediaType, status: string | null, watched = 0, aired = 0): ComputedState | null {
  if (!status) return null;
  if (status === "abandoned" || status === "fridge" || status === "watchlist") return status;
  if (mediaType === "movie") return status === "watching" ? "in_progress" : "watched";
  if (status === "watched") return "completed";
  if (watched === 0) return "watchlist";
  return watched >= aired && aired > 0 ? "up_to_date" : "in_progress";
}

export async function upsertTitleState(input: UpsertTitleStateInput): Promise<void> {
  let seriesProgress = input.seriesProgress;
  if (input.mediaType === "tv" && !seriesProgress) {
    const progress = await computeUserSeriesProgress({
      userId: input.userId,
      seriesTmdbId: input.tmdbId,
    });
    if (progress.ok) seriesProgress = progress.data;
  }

  const status = input.libraryEntry?.status ?? null;
  const progressPct = seriesProgress?.airedEpisodes
    ? Math.min(Math.round((seriesProgress.watchedCount / seriesProgress.airedEpisodes) * 100), 100)
    : 0;

  let durationSortMinutes: number | null = null;
  let durationSortUnavailable = false;

  if (input.mediaType === "movie") {
    const title = await db.poplog3Title.findFirst({
      where: { tmdbId: input.tmdbId, mediaType: "movie" },
      select: { runtime: true },
    });
    durationSortMinutes = title?.runtime && title.runtime > 0 ? title.runtime : null;
    durationSortUnavailable = durationSortMinutes === null;
  } else {
    const [episodes, title] = await Promise.all([
      db.poplog3Episode.findMany({
        where: { seriesTmdbId: input.tmdbId, seasonNumber: { gt: 0 } },
        select: { seasonNumber: true, episodeNumber: true, airDate: true, runtime: true },
      }),
      db.poplog3Title.findFirst({
        where: { tmdbId: input.tmdbId, mediaType: "tv" },
        select: { runtime: true },
      }),
    ]);
    const remaining = calculateRemainingSeriesRuntime({
      episodes,
      watchedKeys: seriesProgress?.watchedKeys ?? [],
      fallbackEpisodeRuntime: title?.runtime ?? null,
    });
    const pendingFromState = Math.max(
      0,
      (seriesProgress?.airedEpisodes ?? 0) - (seriesProgress?.watchedCount ?? 0),
    );
    const stateFallback =
      episodes.length === 0 &&
      (seriesProgress?.airedEpisodes ?? 0) > 0 &&
      title?.runtime && title.runtime > 0
        ? pendingFromState * title.runtime
        : null;
    durationSortMinutes = stateFallback ?? remaining.minutes;
    durationSortUnavailable = remaining.unavailable && stateFallback === null;
  }

  const payload: UpsertUserTitleStateInput = {
    userId: input.userId,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    status: status as LibraryStatus | null,
    favorite: input.libraryEntry?.favorite ?? false,
    liked: input.libraryEntry?.liked ?? null,
    computedState: deriveComputedState(
      input.mediaType,
      status,
      seriesProgress?.watchedCount ?? 0,
      seriesProgress?.airedEpisodes ?? 0,
    ),
    watchedEpisodes: seriesProgress?.watchedCount ?? 0,
    airedEpisodes: seriesProgress?.airedEpisodes ?? 0,
    totalEpisodes: seriesProgress?.totalEpisodes ?? null,
    progressPct,
    nextSeason: seriesProgress?.nextEpisode?.seasonNumber ?? null,
    nextEpisode: seriesProgress?.nextEpisode?.episodeNumber ?? null,
    nextEpisodeAirDate: seriesProgress?.nextEpisode?.airDate ?? null,
    lastWatchedAt: seriesProgress?.lastWatchedAt ?? null,
    watchedKeys: seriesProgress?.watchedKeys ?? [],
    durationSortMinutes,
    durationSortUnavailable,
  };

  const result = await upsertUserTitleState(payload);
  if (!result.ok) throw new Error(result.error);

  if (input.event) {
    await createUserEvent({
      userId: input.userId,
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      eventType: input.event.type,
      payload: input.event.payload ?? {},
    });
  }
}

export async function readTitleState(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<UserTitleState | null> {
  const result = await readUserTitleState({ userId, tmdbId, mediaType });
  if (!result.ok) throw new Error(result.error);
  return result.data ? mapState(result.data) : null;
}

export async function getUserTitleStates(
  userId: string,
  opts: GetUserTitleStatesOptions = {},
): Promise<UserTitleState[]> {
  const result = await listUserTitleStates({
    userId,
    mediaType: opts.mediaType,
    status: opts.status,
    computedState: opts.computedState,
    limit: opts.limit,
  });
  if (!result.ok) throw new Error(result.error);
  return result.data.map(mapState);
}

export async function getUserKnownTitleIds(userId: string): Promise<Set<string>> {
  const states = await getUserTitleStates(userId);
  return new Set(states.map((state) => `${state.tmdb_id}:${state.media_type}`));
}

export async function deleteTitleState(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<void> {
  const result = await deleteUserTitleState({ userId, tmdbId, mediaType });
  if (!result.ok) throw new Error(result.error);
}

export function logUserEvent(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  eventType: UserEventType;
  payload?: Record<string, unknown>;
}): void {
  void createUserEvent(input);
}

export async function refreshTitleStateAvailability(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
  availability: {
    providerName: string | null;
    providerType: string | null;
    providerLogo: string | null;
  } | null,
): Promise<void> {
  const result = await updateUserTitleStateAvailability({
    userId,
    tmdbId,
    mediaType,
    providerName: availability?.providerName ?? null,
    providerType: availability?.providerType ?? null,
    providerLogo: availability?.providerLogo ?? null,
  });
  if (!result.ok) throw new Error(result.error);
}

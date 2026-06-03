import {
  createUserEvent,
  deleteUserTitleState,
  getCachedTitleRow,
  getUserLibraryItems,
  getUserTitle,
  removeUserTitle as removeUserTitleRow,
  upsertUserTitle,
  upsertUserTitleState,
} from "@/server/repositories";
import type {
  Poplog3LibraryStatus,
  Poplog3UserTitle,
  UpsertUserTitleInput,
} from "@/server/library/types";
import type { MediaType, UserTitle } from "@prisma/client";

export type Poplog3UserLibraryItem = Poplog3UserTitle & {
  computed_state?: string | null;
  watched_episodes?: number;
  aired_episodes?: number;
  total_episodes?: number | null;
  progress_pct?: number;
  duration_sort_minutes?: number | null;
  duration_sort_unavailable?: boolean | null;
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
  title: {
    tmdb_id: number;
    media_type: "movie" | "tv";
    title: string | null;
    original_title: string | null;
    poster_path: string | null;
    backdrop_path: string | null;
    year: number | null;
    release_date: string | null;
    first_air_date: string | null;
    last_air_date: string | null;
    runtime: number | null;
    episode_run_time: number[] | null;
    runtime_minutes: number | null;
    runtime_estimated: boolean;
    total_runtime_minutes: number | null;
    total_runtime_estimated: boolean;
    vote_average: number | null;
    popularity: number | null;
    number_of_episodes: number | null;
    number_of_seasons: number | null;
  } | null;
};

function dateTime(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function readNumberArray(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "number")
    ? value
    : null;
}

function mapUserTitle(row: UserTitle): Poplog3UserTitle {
  return {
    id: row.id,
    user_id: row.userId,
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    status: row.status as Poplog3LibraryStatus,
    rating: row.rating,
    liked: row.liked,
    favorite: row.favorite,
    notes: row.notes,
    started_at: dateTime(row.startedAt),
    finished_at: dateTime(row.finishedAt),
    abandoned_at: dateTime(row.abandonedAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

async function enrichLibraryItem(row: UserTitle): Promise<Poplog3UserLibraryItem> {
  const base = mapUserTitle(row);
  const title = await getCachedTitleRow(row.mediaType, row.tmdbId);

  return {
    ...base,
    title: title
      ? {
          tmdb_id: title.tmdbId,
          media_type: title.mediaType,
          title: title.title,
          original_title: title.originalTitle,
          poster_path: title.posterPath,
          backdrop_path: title.backdropPath,
          year: title.year,
          release_date: dateOnly(title.releaseDate),
          first_air_date: dateOnly(title.firstAirDate),
          last_air_date: dateOnly(title.lastAirDate),
          runtime: title.runtime,
          episode_run_time: readNumberArray(title.episodeRunTime),
          runtime_minutes: title.runtime,
          runtime_estimated: false,
          total_runtime_minutes: title.runtime,
          total_runtime_estimated: false,
          vote_average: title.voteAverage === null ? null : Number(title.voteAverage),
          popularity: title.popularity === null ? null : Number(title.popularity),
          number_of_episodes: title.numberOfEpisodes,
          number_of_seasons: title.numberOfSeasons,
        }
      : null,
  };
}

function computedStateFor(mediaType: MediaType, status: Poplog3LibraryStatus) {
  if (mediaType === "movie") {
    if (status === "watching") return "in_progress";
    if (status === "watched") return "watched";
    return status;
  }
  if (status === "watching") return "in_progress";
  if (status === "watched") return "completed";
  return status;
}

export async function getUserLibrary(
  userId: string,
  status?: string,
): Promise<Poplog3UserLibraryItem[]> {
  const result = await getUserLibraryItems({
    userId,
    status: status as Poplog3LibraryStatus | undefined,
  });
  if (!result.ok) throw new Error(result.error);
  return Promise.all(result.data.map(enrichLibraryItem));
}

export async function getUserLibraryState(
  userId: string,
  status?: string,
): Promise<Poplog3UserLibraryItem[] | null> {
  const rows = await getUserLibrary(userId, status);
  return rows.length > 0 ? rows : null;
}

export async function getUserTitleStatus(
  userId: string,
  tmdbId: number,
  mediaType: "movie" | "tv",
): Promise<Poplog3UserTitle | null> {
  const result = await getUserTitle({ userId, tmdbId, mediaType });
  if (!result.ok) throw new Error(result.error);
  return result.data ? mapUserTitle(result.data) : null;
}

export async function upsertUserTitleStatus(
  input: UpsertUserTitleInput,
): Promise<Poplog3UserTitle> {
  const result = await upsertUserTitle(input);
  if (!result.ok) throw new Error(result.error);

  const mapped = mapUserTitle(result.data);
  await upsertUserTitleState({
    userId: input.userId,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    status: input.status,
    favorite: input.favorite ?? false,
    liked: input.liked ?? null,
    computedState: computedStateFor(input.mediaType, input.status),
  });
  await createUserEvent({
    userId: input.userId,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    eventType: input.mediaType === "movie" && input.status === "watched"
      ? "movie_watched"
      : "status_changed",
    payload: { status: input.status, source: "local-service" },
  });

  return mapped;
}

export async function removeUserTitle(
  userId: string,
  tmdbId: number,
  mediaType: "movie" | "tv",
): Promise<void> {
  const result = await removeUserTitleRow({ userId, tmdbId, mediaType });
  if (!result.ok) throw new Error(result.error);
  await deleteUserTitleState({ userId, tmdbId, mediaType });
  await createUserEvent({
    userId,
    tmdbId,
    mediaType,
    eventType: "status_changed",
    payload: { removed: true, source: "local-service" },
  });
}

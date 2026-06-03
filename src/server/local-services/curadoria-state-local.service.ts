import type { UserCuradoriaState, WatchingContentType, WatchingStatus } from "@prisma/client";
import {
  deleteUserCuradoriaState,
  getUserCuradoriaState,
  listUserCuradoriaStates,
  updateUserCuradoriaStateOverlay,
  upsertUserCuradoriaState,
  type UpsertUserCuradoriaStateInput,
} from "@/server/repositories";

export type CuradoriaStateLocalRow = {
  id: string;
  user_id: string;
  content_id: string;
  content_type: WatchingContentType;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  status: WatchingStatus;
  runtime: number | null;
  tmdb_rating: number | null;
  user_rating: number | null;
  added_to_watchlist_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  genres: unknown;
  year: number | null;
  priority_score: number;
  priority_last_calculated_at: string | null;
  snoozed_until: string | null;
  snooze_count: number;
  hero_shown_count: number;
  hero_last_shown_at: string | null;
  dominant_color: string | null;
  rediscovery_eligible: boolean;
  new_episode_available: boolean;
  new_episode_available_since: string | null;
  streaming_platform: string | null;
  streaming_available_since: string | null;
  available_on_vod: boolean;
  vod_available_since: string | null;
  created_at: string;
  updated_at: string;
};

export type CuradoriaStatePatch = Partial<
  Omit<
    UpsertUserCuradoriaStateInput,
    "userId" | "contentId" | "contentType" | "title"
  >
>;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function mapRow(row: UserCuradoriaState): CuradoriaStateLocalRow {
  return {
    id: row.id,
    user_id: row.userId,
    content_id: row.contentId,
    content_type: row.contentType,
    title: row.title,
    poster_path: row.posterPath,
    backdrop_path: row.backdropPath,
    status: row.status,
    runtime: row.runtime,
    tmdb_rating: row.tmdbRating === null ? null : Number(row.tmdbRating),
    user_rating: row.userRating,
    added_to_watchlist_at: iso(row.addedToWatchlistAt),
    started_at: iso(row.startedAt),
    finished_at: iso(row.finishedAt),
    genres: row.genres,
    year: row.year,
    priority_score: Number(row.priorityScore),
    priority_last_calculated_at: iso(row.priorityLastCalculatedAt),
    snoozed_until: iso(row.snoozedUntil),
    snooze_count: row.snoozeCount,
    hero_shown_count: row.heroShownCount,
    hero_last_shown_at: iso(row.heroLastShownAt),
    dominant_color: row.dominantColor,
    rediscovery_eligible: row.rediscoveryEligible,
    new_episode_available: row.newEpisodeAvailable,
    new_episode_available_since: iso(row.newEpisodeAvailableSince),
    streaming_platform: row.streamingPlatform,
    streaming_available_since: iso(row.streamingAvailableSince),
    available_on_vod: row.availableOnVod,
    vod_available_since: iso(row.vodAvailableSince),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function upsertCuradoriaState(
  input: UpsertUserCuradoriaStateInput,
): Promise<CuradoriaStateLocalRow> {
  const result = await upsertUserCuradoriaState(input);
  if (!result.ok) throw new Error(result.error);
  return mapRow(result.data);
}

export async function getCuradoriaState(
  userId: string,
  contentId: string,
): Promise<CuradoriaStateLocalRow | null> {
  const result = await getUserCuradoriaState({ userId, contentId });
  if (!result.ok) throw new Error(result.error);
  return result.data ? mapRow(result.data) : null;
}

export async function getCuradoriaStates(input: {
  userId: string;
  contentIds?: string[];
  limit?: number;
}): Promise<CuradoriaStateLocalRow[]> {
  const result = await listUserCuradoriaStates(input);
  if (!result.ok) throw new Error(result.error);
  return result.data.map(mapRow);
}

export async function updateCuradoriaStateOverlay(input: {
  userId: string;
  contentId: string;
  patch: CuradoriaStatePatch;
}): Promise<CuradoriaStateLocalRow> {
  const result = await updateUserCuradoriaStateOverlay(input);
  if (!result.ok) throw new Error(result.error);
  return mapRow(result.data);
}

export async function removeCuradoriaState(userId: string, contentId: string): Promise<boolean> {
  const result = await deleteUserCuradoriaState({ userId, contentId });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

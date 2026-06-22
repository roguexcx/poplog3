import { Prisma } from "@prisma/client";
import { db } from "@/server/db/client";
import type { ComputedState, LibraryStatus, MediaType, UserTitleState } from "@prisma/client";
import type { RepositoryResult, RepositoryVoidResult } from "./types";

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

export type UpsertUserTitleStateInput = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  status?: LibraryStatus | null;
  favorite?: boolean;
  liked?: boolean | null;
  computedState?: ComputedState | null;
  watchedEpisodes?: number;
  airedEpisodes?: number;
  totalEpisodes?: number | null;
  progressPct?: number;
  nextSeason?: number | null;
  nextEpisode?: number | null;
  nextEpisodeAirDate?: Date | string | null;
  lastWatchedAt?: Date | string | null;
  watchedKeys?: string[];
  franchiseTmdbId?: number | null;
  franchiseName?: string | null;
  franchiseWatched?: number | null;
  franchiseTotal?: number | null;
  bestProviderName?: string | null;
  bestProviderType?: string | null;
  bestProviderLogo?: string | null;
  durationSortMinutes?: number | null;
  durationSortUnavailable?: boolean;
  editorialAffinity?: number;
  editorialPenalty?: number;
  editorialScore?: number;
  hasNegativeFeedback?: boolean;
  isHidden?: boolean;
  isBoosted?: boolean;
  lastFeedbackType?: string | null;
  lastFeedbackAt?: Date | string | null;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function statePatch(input: UpsertUserTitleStateInput) {
  return {
    status: input.status ?? null,
    favorite: input.favorite ?? false,
    liked: input.liked ?? null,
    computedState: input.computedState ?? null,
    watchedEpisodes: input.watchedEpisodes ?? 0,
    airedEpisodes: input.airedEpisodes ?? 0,
    totalEpisodes: input.totalEpisodes ?? null,
    progressPct: input.progressPct ?? 0,
    nextSeason: input.nextSeason ?? null,
    nextEpisode: input.nextEpisode ?? null,
    nextEpisodeAirDate: toDate(input.nextEpisodeAirDate),
    lastWatchedAt: toDate(input.lastWatchedAt),
    watchedKeys: input.watchedKeys ?? [],
    franchiseTmdbId: input.franchiseTmdbId ?? null,
    franchiseName: input.franchiseName ?? null,
    franchiseWatched: input.franchiseWatched ?? null,
    franchiseTotal: input.franchiseTotal ?? null,
    ...(input.bestProviderName !== undefined ? { bestProviderName: input.bestProviderName } : {}),
    ...(input.bestProviderType !== undefined ? { bestProviderType: input.bestProviderType } : {}),
    ...(input.bestProviderLogo !== undefined ? { bestProviderLogo: input.bestProviderLogo } : {}),
    ...(input.durationSortMinutes !== undefined ? { durationSortMinutes: input.durationSortMinutes } : {}),
    ...(input.durationSortUnavailable !== undefined ? { durationSortUnavailable: input.durationSortUnavailable } : {}),
    ...(input.editorialAffinity !== undefined ? { editorialAffinity: input.editorialAffinity } : {}),
    ...(input.editorialPenalty !== undefined ? { editorialPenalty: input.editorialPenalty } : {}),
    ...(input.editorialScore !== undefined ? { editorialScore: input.editorialScore } : {}),
    ...(input.hasNegativeFeedback !== undefined ? { hasNegativeFeedback: input.hasNegativeFeedback } : {}),
    ...(input.isHidden !== undefined ? { isHidden: input.isHidden } : {}),
    ...(input.isBoosted !== undefined ? { isBoosted: input.isBoosted } : {}),
    ...(input.lastFeedbackType !== undefined ? { lastFeedbackType: input.lastFeedbackType } : {}),
    ...(input.lastFeedbackAt !== undefined ? { lastFeedbackAt: toDate(input.lastFeedbackAt) } : {}),
    lastEventAt: new Date(),
  };
}

export async function readUserTitleState(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
}): Promise<RepositoryResult<UserTitleState | null>> {
  try {
    const row = await db.userTitleState.findUnique({
      where: {
        userId_tmdbId_mediaType: {
          userId: input.userId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
        },
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function listUserTitleStates(input: {
  userId: string;
  mediaType?: MediaType;
  status?: LibraryStatus | LibraryStatus[];
  computedState?: ComputedState | ComputedState[];
  limit?: number;
}): Promise<RepositoryResult<UserTitleState[]>> {
  try {
    const rows = await db.userTitleState.findMany({
      where: {
        userId: input.userId,
        mediaType: input.mediaType,
        status: Array.isArray(input.status)
          ? { in: input.status }
          : input.status,
        computedState: Array.isArray(input.computedState)
          ? { in: input.computedState }
          : input.computedState,
      },
      orderBy: { lastEventAt: "desc" },
      take: input.limit,
    });
    return { ok: true, data: rows };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function upsertUserTitleState(
  input: UpsertUserTitleStateInput,
): Promise<RepositoryResult<UserTitleState>> {
  try {
    const patch = statePatch(input);
    const row = await db.userTitleState.upsert({
      where: {
        userId_tmdbId_mediaType: {
          userId: input.userId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
        },
      },
      update: patch,
      create: {
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        ...patch,
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function updateUserTitleStateAvailability(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  providerName: string | null;
  providerType: string | null;
  providerLogo: string | null;
}): Promise<RepositoryVoidResult> {
  try {
    await db.userTitleState.update({
      where: {
        userId_tmdbId_mediaType: {
          userId: input.userId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
        },
      },
      data: {
        bestProviderName: input.providerName,
        bestProviderType: input.providerType,
        bestProviderLogo: input.providerLogo,
      },
    });
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteUserTitleState(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
}): Promise<RepositoryVoidResult> {
  try {
    await db.userTitleState.delete({
      where: {
        userId_tmdbId_mediaType: {
          userId: input.userId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
        },
      },
    });
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function logUserEvent(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  eventType: UserEventType;
  payload?: Record<string, unknown>;
}): Promise<RepositoryVoidResult> {
  try {
    await db.userEvent.create({
      data: {
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        eventType: input.eventType,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
    return { ok: true, data: null };
  } catch (error) {
    console.warn("[user-title-state.repository] event log failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

import { Prisma } from "@prisma/client";
import { db } from "@/server/db/client";
import type { UserCuradoriaState, WatchingContentType, WatchingStatus } from "@prisma/client";
import type { RepositoryResult } from "./types";

export type UpsertUserCuradoriaStateInput = {
  userId: string;
  contentId: string;
  contentType: WatchingContentType;
  title: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  status?: WatchingStatus;
  runtime?: number | null;
  tmdbRating?: number | null;
  userRating?: number | null;
  addedToWatchlistAt?: Date | string | null;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  genres?: unknown;
  year?: number | null;
  priorityScore?: number;
  priorityLastCalculatedAt?: Date | string | null;
  snoozedUntil?: Date | string | null;
  snoozeCount?: number;
  heroShownCount?: number;
  heroLastShownAt?: Date | string | null;
  dominantColor?: string | null;
  rediscoveryEligible?: boolean;
  newEpisodeAvailable?: boolean;
  newEpisodeAvailableSince?: Date | string | null;
  streamingPlatform?: string | null;
  streamingAvailableSince?: Date | string | null;
  availableOnVod?: boolean;
  vodAvailableSince?: Date | string | null;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toDate(value: Date | string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function toDecimal(value: number | null | undefined) {
  if (value === undefined || value === null) return value;
  return new Prisma.Decimal(value);
}

function buildData(input: UpsertUserCuradoriaStateInput) {
  return {
    contentType: input.contentType,
    title: input.title,
    posterPath: input.posterPath ?? null,
    backdropPath: input.backdropPath ?? null,
    status: input.status ?? "watching",
    runtime: input.runtime ?? null,
    tmdbRating: toDecimal(input.tmdbRating ?? null),
    userRating: input.userRating ?? null,
    addedToWatchlistAt: toDate(input.addedToWatchlistAt) ?? null,
    startedAt: toDate(input.startedAt) ?? null,
    finishedAt: toDate(input.finishedAt) ?? null,
    genres: input.genres === undefined || input.genres === null ? Prisma.JsonNull : (input.genres as Prisma.InputJsonValue),
    year: input.year ?? null,
    priorityScore: toDecimal(input.priorityScore ?? 0) ?? new Prisma.Decimal(0),
    priorityLastCalculatedAt: toDate(input.priorityLastCalculatedAt) ?? null,
    snoozedUntil: toDate(input.snoozedUntil) ?? null,
    snoozeCount: input.snoozeCount ?? 0,
    heroShownCount: input.heroShownCount ?? 0,
    heroLastShownAt: toDate(input.heroLastShownAt) ?? null,
    dominantColor: input.dominantColor ?? null,
    rediscoveryEligible: input.rediscoveryEligible ?? false,
    newEpisodeAvailable: input.newEpisodeAvailable ?? false,
    newEpisodeAvailableSince: toDate(input.newEpisodeAvailableSince) ?? null,
    streamingPlatform: input.streamingPlatform ?? null,
    streamingAvailableSince: toDate(input.streamingAvailableSince) ?? null,
    availableOnVod: input.availableOnVod ?? false,
    vodAvailableSince: toDate(input.vodAvailableSince) ?? null,
  };
}

function buildPatchData(
  patch: Partial<Omit<UpsertUserCuradoriaStateInput, "userId" | "contentId" | "contentType" | "title">>,
): Prisma.UserCuradoriaStateUpdateInput {
  const data: Prisma.UserCuradoriaStateUpdateInput = {};
  if ("posterPath" in patch) data.posterPath = patch.posterPath ?? null;
  if ("backdropPath" in patch) data.backdropPath = patch.backdropPath ?? null;
  if ("status" in patch) data.status = patch.status;
  if ("runtime" in patch) data.runtime = patch.runtime ?? null;
  if ("tmdbRating" in patch) data.tmdbRating = toDecimal(patch.tmdbRating ?? null);
  if ("userRating" in patch) data.userRating = patch.userRating ?? null;
  if ("addedToWatchlistAt" in patch) data.addedToWatchlistAt = toDate(patch.addedToWatchlistAt) ?? null;
  if ("startedAt" in patch) data.startedAt = toDate(patch.startedAt) ?? null;
  if ("finishedAt" in patch) data.finishedAt = toDate(patch.finishedAt) ?? null;
  if ("genres" in patch) {
    data.genres = patch.genres === null || patch.genres === undefined
      ? Prisma.JsonNull
      : (patch.genres as Prisma.InputJsonValue);
  }
  if ("year" in patch) data.year = patch.year ?? null;
  if ("priorityScore" in patch) data.priorityScore = new Prisma.Decimal(patch.priorityScore ?? 0);
  if ("priorityLastCalculatedAt" in patch) {
    data.priorityLastCalculatedAt = toDate(patch.priorityLastCalculatedAt) ?? null;
  }
  if ("snoozedUntil" in patch) data.snoozedUntil = toDate(patch.snoozedUntil) ?? null;
  if ("snoozeCount" in patch) data.snoozeCount = patch.snoozeCount ?? 0;
  if ("heroShownCount" in patch) data.heroShownCount = patch.heroShownCount ?? 0;
  if ("heroLastShownAt" in patch) data.heroLastShownAt = toDate(patch.heroLastShownAt) ?? null;
  if ("dominantColor" in patch) data.dominantColor = patch.dominantColor ?? null;
  if ("rediscoveryEligible" in patch) data.rediscoveryEligible = patch.rediscoveryEligible ?? false;
  if ("newEpisodeAvailable" in patch) data.newEpisodeAvailable = patch.newEpisodeAvailable ?? false;
  if ("newEpisodeAvailableSince" in patch) {
    data.newEpisodeAvailableSince = toDate(patch.newEpisodeAvailableSince) ?? null;
  }
  if ("streamingPlatform" in patch) data.streamingPlatform = patch.streamingPlatform ?? null;
  if ("streamingAvailableSince" in patch) {
    data.streamingAvailableSince = toDate(patch.streamingAvailableSince) ?? null;
  }
  if ("availableOnVod" in patch) data.availableOnVod = patch.availableOnVod ?? false;
  if ("vodAvailableSince" in patch) data.vodAvailableSince = toDate(patch.vodAvailableSince) ?? null;
  return data;
}

export async function upsertUserCuradoriaState(
  input: UpsertUserCuradoriaStateInput,
): Promise<RepositoryResult<UserCuradoriaState>> {
  try {
    const data = buildData(input);
    const row = await db.userCuradoriaState.upsert({
      where: { userId_contentId: { userId: input.userId, contentId: input.contentId } },
      update: data,
      create: {
        userId: input.userId,
        contentId: input.contentId,
        ...data,
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function getUserCuradoriaState(input: {
  userId: string;
  contentId: string;
}): Promise<RepositoryResult<UserCuradoriaState | null>> {
  try {
    const row = await db.userCuradoriaState.findUnique({
      where: { userId_contentId: { userId: input.userId, contentId: input.contentId } },
    });
    return { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function listUserCuradoriaStates(input: {
  userId: string;
  contentIds?: string[];
  limit?: number;
}): Promise<RepositoryResult<UserCuradoriaState[]>> {
  try {
    const rows = await db.userCuradoriaState.findMany({
      where: {
        userId: input.userId,
        contentId: input.contentIds ? { in: input.contentIds } : undefined,
      },
      orderBy: { updatedAt: "desc" },
      take: input.limit ?? 120,
    });
    return { ok: true, data: rows };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function updateUserCuradoriaStateOverlay(input: {
  userId: string;
  contentId: string;
  patch: Partial<Omit<UpsertUserCuradoriaStateInput, "userId" | "contentId" | "contentType" | "title">>;
}): Promise<RepositoryResult<UserCuradoriaState>> {
  try {
    const row = await db.userCuradoriaState.update({
      where: { userId_contentId: { userId: input.userId, contentId: input.contentId } },
      data: buildPatchData(input.patch),
    });
    return { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteUserCuradoriaState(input: {
  userId: string;
  contentId: string;
}): Promise<RepositoryResult<boolean>> {
  try {
    await db.userCuradoriaState.delete({
      where: { userId_contentId: { userId: input.userId, contentId: input.contentId } },
    });
    return { ok: true, data: true };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

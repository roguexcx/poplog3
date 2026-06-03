import { db } from "@/server/db/client";
import type {
  FeedbackScope,
  FeedbackSurface,
  FeedbackType,
  MediaType,
  UserTitleFeedback,
} from "@prisma/client";
import type { RepositoryResult, RepositoryVoidResult } from "./types";

export type FeedbackCommand = FeedbackType | "dismissed" | "favorite" | "unfavorite" | "clear_like";

export type SaveUserTitleFeedbackInput = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  feedbackType: FeedbackCommand;
  weight?: number;
  reason?: string | null;
  source?: string | null;
  surface?: FeedbackSurface | null;
  scope?: FeedbackScope;
  sectionKey?: string | null;
  expiresAt?: Date | string | null;
  metadata?: Record<string, unknown>;
  strength?: number | null;
  confidence?: number | null;
};

export type TitleFeedbackState = {
  notInterested: boolean;
  activeFeedbackTypes: FeedbackType[];
  latestFeedback?: UserTitleFeedback;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeFeedbackType(command: FeedbackCommand): FeedbackType | null {
  if (command === "favorite" || command === "unfavorite" || command === "clear_like") {
    return null;
  }
  if (command === "dismissed") return "dismissed_from_section";
  return command;
}

export function normalizeUserFeedbackWeight(type: FeedbackType, weight?: number): number {
  if (typeof weight === "number" && Number.isFinite(weight)) return weight;
  if (type === "not_interested") return -1;
  if (type === "disliked" || type === "hidden") return -2;
  if (type === "boosted" || type === "liked") return 1;
  return -0.5;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function buildUserFeedbackKey(tmdbId: number, mediaType: MediaType): string {
  return `${mediaType}:${tmdbId}`;
}

export function buildTitleFeedbackState(
  rows: UserTitleFeedback[] | null | undefined,
): TitleFeedbackState {
  const activeRows = (rows ?? []).filter((row) => row.active !== false);
  const activeFeedbackTypes = activeRows.map((row) => row.feedbackType);

  return {
    notInterested: activeFeedbackTypes.includes("not_interested"),
    activeFeedbackTypes,
    latestFeedback: activeRows[0],
  };
}

export async function saveUserTitleFeedback(
  input: SaveUserTitleFeedbackInput,
): Promise<RepositoryResult<UserTitleFeedback | null>> {
  const feedbackType = normalizeFeedbackType(input.feedbackType);
  if (!feedbackType) {
    return { ok: true, data: null };
  }

  try {
    if (feedbackType === "liked" || feedbackType === "disliked") {
      const conflictingType = feedbackType === "liked" ? "disliked" : "liked";
      await db.userTitleFeedback.updateMany({
        where: {
          userId: input.userId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
          feedbackType: conflictingType,
          active: true,
        },
        data: { active: false },
      });
    }

    const row = await db.userTitleFeedback.upsert({
      where: {
        userId_tmdbId_mediaType_feedbackType: {
          userId: input.userId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
          feedbackType,
        },
      },
      update: {
        active: true,
        weight: normalizeUserFeedbackWeight(feedbackType, input.weight),
        reason: input.reason?.slice(0, 240) ?? null,
        source: input.source?.slice(0, 120) ?? null,
        surface: input.surface ?? null,
        scope: input.scope ?? (input.sectionKey ? "section" : "global"),
        sectionKey: input.sectionKey?.slice(0, 160) ?? null,
        expiresAt: toDate(input.expiresAt),
        metadata: input.metadata ?? {},
        strength: input.strength ?? null,
        confidence: input.confidence ?? null,
      },
      create: {
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        feedbackType,
        active: true,
        weight: normalizeUserFeedbackWeight(feedbackType, input.weight),
        reason: input.reason?.slice(0, 240) ?? null,
        source: input.source?.slice(0, 120) ?? null,
        surface: input.surface ?? null,
        scope: input.scope ?? (input.sectionKey ? "section" : "global"),
        sectionKey: input.sectionKey?.slice(0, 160) ?? null,
        expiresAt: toDate(input.expiresAt),
        metadata: input.metadata ?? {},
        strength: input.strength ?? null,
        confidence: input.confidence ?? null,
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function getTitleFeedbackRows(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  activeOnly?: boolean;
}): Promise<RepositoryResult<UserTitleFeedback[]>> {
  try {
    const rows = await db.userTitleFeedback.findMany({
      where: {
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        active: input.activeOnly ? true : undefined,
      },
      orderBy: { updatedAt: "desc" },
    });
    return { ok: true, data: rows };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function getUserActiveFeedbackMap(
  userId: string,
): Promise<RepositoryResult<Map<string, UserTitleFeedback[]>>> {
  try {
    const rows = await db.userTitleFeedback.findMany({
      where: { userId, active: true },
      orderBy: { updatedAt: "desc" },
    });
    const map = new Map<string, UserTitleFeedback[]>();
    for (const row of rows) {
      const key = buildUserFeedbackKey(row.tmdbId, row.mediaType);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return { ok: true, data: map };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deactivateUserTitleFeedback(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  feedbackType?: FeedbackCommand;
}): Promise<RepositoryResult<number>> {
  const feedbackType = input.feedbackType ? normalizeFeedbackType(input.feedbackType) : undefined;
  if (input.feedbackType && !feedbackType) return { ok: true, data: 0 };

  try {
    const result = await db.userTitleFeedback.updateMany({
      where: {
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        feedbackType,
      },
      data: { active: false },
    });
    return { ok: true, data: result.count };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteUserTitleFeedbackRows(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  feedbackType?: FeedbackCommand;
}): Promise<RepositoryResult<number>> {
  const feedbackType = input.feedbackType ? normalizeFeedbackType(input.feedbackType) : undefined;
  if (input.feedbackType && !feedbackType) return { ok: true, data: 0 };

  try {
    const result = await db.userTitleFeedback.deleteMany({
      where: {
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        feedbackType,
      },
    });
    return { ok: true, data: result.count };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function syncFeedbackFlagsToTitleState(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  liked?: boolean | null;
  favorite?: boolean;
  hasNegativeFeedback?: boolean;
  isHidden?: boolean;
  isBoosted?: boolean;
  lastFeedbackType?: string | null;
  lastFeedbackAt?: Date | string | null;
}): Promise<RepositoryVoidResult> {
  try {
    const now = new Date();
    const statePatch = {
      liked: input.liked,
      favorite: input.favorite,
      hasNegativeFeedback: input.hasNegativeFeedback,
      isHidden: input.isHidden,
      isBoosted: input.isBoosted,
      lastFeedbackType: input.lastFeedbackType ?? null,
      lastFeedbackAt: toDate(input.lastFeedbackAt) ?? now,
      lastEventAt: now,
    };

    await db.userTitleState.upsert({
      where: {
        userId_tmdbId_mediaType: {
          userId: input.userId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
        },
      },
      update: statePatch,
      create: {
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        watchedKeys: [],
        ...statePatch,
      },
    });

    const libraryPatch: { liked?: boolean | null; favorite?: boolean } = {};
    if ("liked" in input) libraryPatch.liked = input.liked ?? null;
    if ("favorite" in input && typeof input.favorite === "boolean") {
      libraryPatch.favorite = input.favorite;
    }
    if (Object.keys(libraryPatch).length > 0) {
      await db.userTitle.updateMany({
        where: {
          userId: input.userId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
        },
        data: libraryPatch,
      });
    }

    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

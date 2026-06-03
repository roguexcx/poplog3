import { db } from "@/server/db/client";
import type { RatingMediaType, RatingSource, UserRating } from "@prisma/client";
import type { RepositoryResult, RepositoryVoidResult } from "./types";

export type UpsertUserRatingInput = {
  userId: string;
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  rating: number;
  ratingSource?: RatingSource;
  isPublic?: boolean;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildUserRatingItemKey(
  mediaType: RatingMediaType,
  tmdbId: number,
  seasonNumber?: number | null,
  episodeNumber?: number | null,
) {
  return `${mediaType}:${tmdbId}:${seasonNumber ?? ""}:${episodeNumber ?? ""}`;
}

function clampRating(value: number): number {
  const rounded = Math.round(value * 2) / 2;
  return Math.min(5, Math.max(0, rounded));
}

export async function getUserRating(input: {
  userId: string;
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}): Promise<RepositoryResult<UserRating | null>> {
  try {
    const itemKey = buildUserRatingItemKey(
      input.mediaType,
      input.tmdbId,
      input.seasonNumber,
      input.episodeNumber,
    );
    const row = await db.userRating.findUnique({
      where: {
        userId_itemKey: {
          userId: input.userId,
          itemKey,
        },
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function getUserRatingsBatch(input: {
  userId: string;
  items: Array<{
    mediaType: RatingMediaType;
    tmdbId: number;
    seasonNumber?: number | null;
    episodeNumber?: number | null;
  }>;
}): Promise<RepositoryResult<Map<string, UserRating>>> {
  try {
    const keys = input.items.map((item) =>
      buildUserRatingItemKey(item.mediaType, item.tmdbId, item.seasonNumber, item.episodeNumber),
    );
    const rows = await db.userRating.findMany({
      where: {
        userId: input.userId,
        itemKey: { in: keys },
      },
    });
    return { ok: true, data: new Map(rows.map((row) => [row.itemKey, row])) };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function upsertUserRating(
  input: UpsertUserRatingInput,
): Promise<RepositoryResult<UserRating>> {
  try {
    const itemKey = buildUserRatingItemKey(
      input.mediaType,
      input.tmdbId,
      input.seasonNumber,
      input.episodeNumber,
    );
    const row = await db.userRating.upsert({
      where: {
        userId_itemKey: {
          userId: input.userId,
          itemKey,
        },
      },
      update: {
        rating: clampRating(input.rating),
        ratingSource: input.ratingSource ?? "explicit",
        isPublic: input.isPublic ?? true,
      },
      create: {
        userId: input.userId,
        mediaType: input.mediaType,
        tmdbId: input.tmdbId,
        seasonNumber: input.seasonNumber ?? null,
        episodeNumber: input.episodeNumber ?? null,
        itemKey,
        rating: clampRating(input.rating),
        ratingSource: input.ratingSource ?? "explicit",
        isPublic: input.isPublic ?? true,
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteUserRating(input: {
  userId: string;
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
}): Promise<RepositoryVoidResult> {
  try {
    const itemKey = buildUserRatingItemKey(
      input.mediaType,
      input.tmdbId,
      input.seasonNumber,
      input.episodeNumber,
    );
    await db.userRating.delete({
      where: {
        userId_itemKey: {
          userId: input.userId,
          itemKey,
        },
      },
    });
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

import {
  buildUserRatingItemKey,
  deleteUserRating as deleteUserRatingRow,
  getUserRating as getUserRatingRow,
  getUserRatingsBatch as getUserRatingRowsBatch,
  upsertUserRating as upsertUserRatingRow,
} from "@/server/repositories";
import type { UserRating } from "@prisma/client";
import type { RatingMediaType, RatingSource, UserRatingData } from "@/types/user";

export type { RatingMediaType, RatingSource, UserRatingData };

export type BatchRatingItem = {
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
};

export type BatchRatingResult = Map<string, UserRatingData>;

export type UpsertRatingInput = {
  userId: string;
  mediaType: RatingMediaType;
  tmdbId: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  rating: number;
  ratingSource?: RatingSource;
  isPublic?: boolean;
};

export type DeleteRatingInput = Omit<UpsertRatingInput, "rating" | "ratingSource" | "isPublic">;

function mapRating(row: UserRating): UserRatingData {
  return {
    rating: Number(row.rating),
    ratingSource: row.ratingSource,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function buildItemKey(
  mediaType: RatingMediaType,
  tmdbId: number,
  seasonNumber?: number | null,
  episodeNumber?: number | null,
) {
  return buildUserRatingItemKey(mediaType, tmdbId, seasonNumber, episodeNumber);
}

export async function getUserRating(
  userId: string,
  mediaType: RatingMediaType,
  tmdbId: number,
  seasonNumber?: number | null,
  episodeNumber?: number | null,
): Promise<UserRatingData | null> {
  const result = await getUserRatingRow({ userId, mediaType, tmdbId, seasonNumber, episodeNumber });
  if (!result.ok) throw new Error(result.error);
  return result.data ? mapRating(result.data) : null;
}

export async function getUserRatingsBatch(
  userId: string,
  items: BatchRatingItem[],
): Promise<BatchRatingResult> {
  const result = await getUserRatingRowsBatch({ userId, items });
  if (!result.ok) throw new Error(result.error);
  return new Map(Array.from(result.data.entries()).map(([key, row]) => [key, mapRating(row)]));
}

export async function upsertUserRating(input: UpsertRatingInput): Promise<UserRatingData> {
  const result = await upsertUserRatingRow(input);
  if (!result.ok) throw new Error(result.error);
  return mapRating(result.data);
}

export async function deleteUserRating(input: DeleteRatingInput): Promise<void> {
  const result = await deleteUserRatingRow(input);
  if (!result.ok) throw new Error(result.error);
}

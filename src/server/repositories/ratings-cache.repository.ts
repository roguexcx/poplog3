import { db } from "@/server/db/client";
import type { MediaType } from "@prisma/client";

export type UpsertRatingsCacheInput = {
  tmdbId: number;
  mediaType: MediaType;
  imdbRating?: number | null;
  imdbVotes?: number | null;
  rottenTomatoesScore?: number | null;
  metacriticScore?: number | null;
  tmdbRating?: number | null;
  poplogScore?: number | null;
  sourcePayload?: unknown;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRatingsCacheFresh(updatedAt: string | Date | null | undefined, maxAgeDays = 30) {
  if (!updatedAt) return false;
  const updatedTime = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedTime)) return false;
  return Date.now() - updatedTime <= maxAgeDays * 24 * 60 * 60 * 1000;
}

export async function getCachedRatingsRow(mediaType: MediaType, tmdbId: number) {
  try {
    return await db.titleRating.findUnique({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
    });
  } catch (error) {
    console.warn("[ratings-cache.repository] read failed", messageFromError(error));
    return null;
  }
}

export async function upsertRatingsCache(input: UpsertRatingsCacheInput): Promise<boolean> {
  try {
    await db.titleRating.upsert({
      where: {
        tmdbId_mediaType: {
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
        },
      },
      update: {
        imdbRating: input.imdbRating ?? null,
        imdbVotes: input.imdbVotes ?? null,
        rottenTomatoesScore: input.rottenTomatoesScore ?? null,
        metacriticScore: input.metacriticScore ?? null,
        tmdbRating: input.tmdbRating ?? null,
        poplogScore: input.poplogScore ?? null,
        sourcePayload: input.sourcePayload as object ?? undefined,
      },
      create: {
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        imdbRating: input.imdbRating ?? null,
        imdbVotes: input.imdbVotes ?? null,
        rottenTomatoesScore: input.rottenTomatoesScore ?? null,
        metacriticScore: input.metacriticScore ?? null,
        tmdbRating: input.tmdbRating ?? null,
        poplogScore: input.poplogScore ?? null,
        sourcePayload: input.sourcePayload as object ?? undefined,
      },
    });
    return true;
  } catch (error) {
    console.warn("[ratings-cache.repository] upsert failed", messageFromError(error));
    return false;
  }
}

export async function deleteRatingsCache(mediaType: MediaType, tmdbId: number): Promise<boolean> {
  try {
    await db.titleRating.delete({ where: { tmdbId_mediaType: { tmdbId, mediaType } } });
    return true;
  } catch (error) {
    console.warn("[ratings-cache.repository] delete failed", messageFromError(error));
    return false;
  }
}

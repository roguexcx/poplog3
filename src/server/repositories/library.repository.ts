import { db } from "@/server/db/client";
import type { LibraryStatus, MediaType, UserTitle } from "@prisma/client";
import type { RepositoryResult, RepositoryVoidResult } from "./types";

export type UpsertUserTitleInput = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  status: LibraryStatus;
  liked?: boolean | null;
  favorite?: boolean;
  rating?: number | null;
  notes?: string | null;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function timestampForStatus(status: LibraryStatus, now: Date) {
  return {
    startedAt: status === "watching" ? now : undefined,
    finishedAt: status === "watched" ? now : undefined,
    abandonedAt: status === "abandoned" ? now : undefined,
  };
}

export async function getUserLibraryItems(input: {
  userId: string;
  status?: LibraryStatus;
}): Promise<RepositoryResult<UserTitle[]>> {
  try {
    const rows = await db.userTitle.findMany({
      where: {
        userId: input.userId,
        status: input.status,
      },
      orderBy: { createdAt: "desc" },
    });
    return { ok: true, data: rows };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function getUserTitle(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
}): Promise<RepositoryResult<UserTitle | null>> {
  try {
    const row = await db.userTitle.findUnique({
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

export async function upsertUserTitle(
  input: UpsertUserTitleInput,
): Promise<RepositoryResult<UserTitle>> {
  try {
    const now = new Date();
    const statusTimestamps = timestampForStatus(input.status, now);
    const row = await db.userTitle.upsert({
      where: {
        userId_tmdbId_mediaType: {
          userId: input.userId,
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
        },
      },
      update: {
        status: input.status,
        liked: input.liked ?? null,
        favorite: input.favorite ?? false,
        rating: input.rating ?? null,
        notes: input.notes ?? null,
        ...statusTimestamps,
      },
      create: {
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        status: input.status,
        liked: input.liked ?? null,
        favorite: input.favorite ?? false,
        rating: input.rating ?? null,
        notes: input.notes ?? null,
        ...statusTimestamps,
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function removeUserTitle(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
}): Promise<RepositoryVoidResult> {
  try {
    await db.userTitle.delete({
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

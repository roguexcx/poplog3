import { db } from "@/server/db/client";
import type { MediaType } from "@prisma/client";

export type UpsertExternalIdsCacheInput = {
  tmdbId: number;
  mediaType: MediaType;
  imdbId?: string | null;
  tvdbId?: string | null;
  traktId?: string | null;
  watchmodeId?: number | null;
  motnId?: string | null;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function getExternalIdsCache(mediaType: MediaType, tmdbId: number) {
  try {
    return await db.titleExternalId.findUnique({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
    });
  } catch (error) {
    console.warn("[external-ids-cache.repository] read failed", messageFromError(error));
    return null;
  }
}

export async function upsertExternalIdsCache(input: UpsertExternalIdsCacheInput): Promise<boolean> {
  try {
    const existing = await getExternalIdsCache(input.mediaType, input.tmdbId);
    await db.titleExternalId.upsert({
      where: { tmdbId_mediaType: { tmdbId: input.tmdbId, mediaType: input.mediaType } },
      update: {
        imdbId: input.imdbId ?? existing?.imdbId ?? null,
        tvdbId: input.tvdbId ?? existing?.tvdbId ?? null,
        traktId: input.traktId ?? existing?.traktId ?? null,
        watchmodeId: input.watchmodeId ?? existing?.watchmodeId ?? null,
        motnId: input.motnId ?? existing?.motnId ?? null,
      },
      create: {
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        imdbId: input.imdbId ?? null,
        tvdbId: input.tvdbId ?? null,
        traktId: input.traktId ?? null,
        watchmodeId: input.watchmodeId ?? null,
        motnId: input.motnId ?? null,
      },
    });
    return true;
  } catch (error) {
    console.warn("[external-ids-cache.repository] upsert failed", messageFromError(error));
    return false;
  }
}

export async function deleteExternalIdsCache(mediaType: MediaType, tmdbId: number): Promise<boolean> {
  try {
    await db.titleExternalId.delete({ where: { tmdbId_mediaType: { tmdbId, mediaType } } });
    return true;
  } catch (error) {
    console.warn("[external-ids-cache.repository] delete failed", messageFromError(error));
    return false;
  }
}

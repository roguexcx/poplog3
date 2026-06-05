import { db } from "@/server/db/client";
import type { MediaType, Poplog3Title } from "@prisma/client";

export type TitleCacheRow = Poplog3Title;

export type UpsertTitleCacheInput = {
  tmdbId: number;
  mediaType: MediaType;
  title?: string | null;
  originalTitle?: string | null;
  overview?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string | Date | null;
  firstAirDate?: string | Date | null;
  lastAirDate?: string | Date | null;
  year?: number | null;
  runtime?: number | null;
  episodeRunTime?: unknown;
  genres?: unknown;
  popularity?: number | null;
  voteAverage?: number | null;
  voteCount?: number | null;
  numberOfEpisodes?: number | null;
  numberOfSeasons?: number | null;
  originalLanguage?: string | null;
  tmdbPayload?: unknown;
  lastSyncedAt?: string | Date | null;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeImagePath(path: string | null | undefined): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  // Full URLs (Balloonerismm, IMDb, CDN) — pass through as-is
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  // TMDB paths — normalize leading slash
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function isTitleCacheFresh(lastSyncedAt?: string | Date | null, maxAgeDays = 7) {
  if (!lastSyncedAt) return false;
  const syncedTime = lastSyncedAt instanceof Date
    ? lastSyncedAt.getTime()
    : new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(syncedTime)) return false;
  return Date.now() - syncedTime < maxAgeDays * 24 * 60 * 60 * 1000;
}

export function isTitlePayloadComplete(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as Record<string, unknown>;
  return ["credits", "videos", "recommendations", "external_ids", "watch/providers"].every(
    (key) => key in obj,
  );
}

export async function getCachedTitleRow(
  mediaType: MediaType,
  tmdbId: number,
): Promise<TitleCacheRow | null> {
  try {
    return await db.poplog3Title.findUnique({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
    });
  } catch (error) {
    console.warn("[title-cache.repository] read failed", messageFromError(error));
    return null;
  }
}

export async function upsertCachedTitleRow(input: UpsertTitleCacheInput): Promise<boolean> {
  if (!input.tmdbId || !input.mediaType) return false;

  try {
    const existing = await getCachedTitleRow(input.mediaType, input.tmdbId);
    const now = new Date();
    const lastSyncedAt = toDate(input.lastSyncedAt) ?? now;

    await db.poplog3Title.upsert({
      where: {
        tmdbId_mediaType: {
          tmdbId: input.tmdbId,
          mediaType: input.mediaType,
        },
      },
      update: {
        title: input.title ?? existing?.title ?? null,
        originalTitle: input.originalTitle ?? existing?.originalTitle ?? null,
        overview: input.overview ?? existing?.overview ?? null,
        posterPath: normalizeImagePath(input.posterPath) ?? existing?.posterPath ?? null,
        backdropPath: normalizeImagePath(input.backdropPath) ?? existing?.backdropPath ?? null,
        releaseDate: toDate(input.releaseDate) ?? existing?.releaseDate ?? null,
        firstAirDate: toDate(input.firstAirDate) ?? existing?.firstAirDate ?? null,
        lastAirDate: toDate(input.lastAirDate) ?? existing?.lastAirDate ?? null,
        year: input.year ?? existing?.year ?? null,
        runtime: input.runtime ?? existing?.runtime ?? null,
        episodeRunTime: input.episodeRunTime === undefined ? existing?.episodeRunTime ?? undefined : input.episodeRunTime as object,
        genres: input.genres === undefined ? existing?.genres ?? undefined : input.genres as object,
        popularity: input.popularity ?? existing?.popularity ?? null,
        voteAverage: input.voteAverage ?? existing?.voteAverage ?? null,
        voteCount: input.voteCount ?? existing?.voteCount ?? null,
        numberOfEpisodes: input.numberOfEpisodes ?? existing?.numberOfEpisodes ?? null,
        numberOfSeasons: input.numberOfSeasons ?? existing?.numberOfSeasons ?? null,
        originalLanguage: input.originalLanguage ?? existing?.originalLanguage ?? null,
        tmdbPayload: input.tmdbPayload === undefined ? existing?.tmdbPayload ?? undefined : input.tmdbPayload as object,
        lastSyncedAt,
      },
      create: {
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        title: input.title ?? null,
        originalTitle: input.originalTitle ?? null,
        overview: input.overview ?? null,
        posterPath: normalizeImagePath(input.posterPath),
        backdropPath: normalizeImagePath(input.backdropPath),
        releaseDate: toDate(input.releaseDate),
        firstAirDate: toDate(input.firstAirDate),
        lastAirDate: toDate(input.lastAirDate),
        year: input.year ?? null,
        runtime: input.runtime ?? null,
        episodeRunTime: input.episodeRunTime as object ?? undefined,
        genres: input.genres as object ?? undefined,
        popularity: input.popularity ?? null,
        voteAverage: input.voteAverage ?? null,
        voteCount: input.voteCount ?? null,
        numberOfEpisodes: input.numberOfEpisodes ?? null,
        numberOfSeasons: input.numberOfSeasons ?? null,
        originalLanguage: input.originalLanguage ?? null,
        tmdbPayload: input.tmdbPayload as object ?? undefined,
        lastSyncedAt,
      },
    });

    return true;
  } catch (error) {
    console.warn("[title-cache.repository] upsert failed", messageFromError(error));
    return false;
  }
}

export async function deleteCachedTitleRow(mediaType: MediaType, tmdbId: number): Promise<boolean> {
  try {
    await db.poplog3Title.delete({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
    });
    return true;
  } catch (error) {
    console.warn("[title-cache.repository] delete failed", messageFromError(error));
    return false;
  }
}

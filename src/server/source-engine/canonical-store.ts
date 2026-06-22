import { db } from "@/server/db/client";
import { syntheticTmdbFromImdbId } from "@/lib/ids/synthetic-tmdb-id";
import { normalizeSearchTerm } from "@/server/search/fuzzy-title-search";
import type { CatalogSearchResult, CatalogTitle } from "./types/catalog.types";

type MediaType = "movie" | "tv";

const SOURCE_VERSION = "trakt-v2";

export type CanonicalCacheStatus = "hit" | "miss" | "stale" | "refreshing" | "failed";

export type CanonicalTitleInput = {
  mediaType: MediaType;
  title: string;
  originalTitle?: string | null;
  overview?: string | null;
  year?: number | null;
  releaseDate?: string | null;
  firstAirDate?: string | null;
  lastAirDate?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  runtime?: number | null;
  genres?: unknown;
  popularity?: number | null;
  voteAverage?: number | null;
  voteCount?: number | null;
  numberOfSeasons?: number | null;
  numberOfEpisodes?: number | null;
  originalLanguage?: string | null;
  ids: {
    traktId?: number | string | null;
    imdbId?: string | null;
    tmdbId?: number | null;
    tvdbId?: number | string | null;
    slug?: string | null;
  };
  rawPayload?: unknown;
  ttlSeconds?: number;
  cacheStatus?: CanonicalCacheStatus;
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeImage(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(trimmed)) return trimmed;
  if (/^\/[a-z0-9.-]+\.[a-z]{2,}\//i.test(trimmed)) return trimmed.slice(1);
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function stableSyntheticId(input: CanonicalTitleInput): number {
  if (typeof input.ids.tmdbId === "number" && input.ids.tmdbId > 0) return input.ids.tmdbId;
  if (input.ids.imdbId) {
    const synthetic = syntheticTmdbFromImdbId(input.ids.imdbId);
    if (synthetic != null) return synthetic;
  }

  const key = [
    input.mediaType,
    input.ids.traktId,
    input.ids.slug,
    normalizeSearchTerm(input.title),
    input.year ?? "",
  ].join("|");

  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return -1 * (1_900_000_000 + (hash % 90_000_000));
}

function traktBigInt(value: number | string | null | undefined): bigint | null {
  if (value == null || value === "") return null;
  const parsed = BigInt(String(value));
  return parsed > BigInt(0) ? parsed : null;
}

/** TTL padrão: 24 h fresh → expiresAt; 3 d extra → staleAt. */
const DEFAULT_TTL_SECONDS = 86_400;
const STALE_WINDOW_SECONDS = 3 * 86_400;

function computeExpiresAt(ttlSeconds = DEFAULT_TTL_SECONDS): Date {
  return new Date(Date.now() + ttlSeconds * 1_000);
}

function computeStaleAt(ttlSeconds = DEFAULT_TTL_SECONDS): Date {
  return new Date(Date.now() + (ttlSeconds + STALE_WINDOW_SECONDS) * 1_000);
}

export async function upsertCanonicalTitle(input: CanonicalTitleInput) {
  const tmdbId = stableSyntheticId(input);
  const traktId = traktBigInt(input.ids.traktId);
  const imdbId = input.ids.imdbId ?? null;
  const now = new Date();
  const cacheUntil = computeExpiresAt(input.ttlSeconds);
  const cacheStaleAt = computeStaleAt(input.ttlSeconds);

  const row = await db.poplog3Title.upsert({
    where: {
      tmdbId_mediaType: {
        tmdbId,
        mediaType: input.mediaType,
      },
    },
    update: {
      traktId,
      imdbId,
      slug: input.ids.slug ?? undefined,
      title: input.title,
      originalTitle: input.originalTitle ?? input.title,
      overview: input.overview ?? undefined,
      posterPath: normalizeImage(input.posterUrl) ?? undefined,
      backdropPath: normalizeImage(input.backdropUrl) ?? undefined,
      releaseDate: input.mediaType === "movie" ? toDate(input.releaseDate) : undefined,
      firstAirDate: input.mediaType === "tv" ? toDate(input.firstAirDate ?? input.releaseDate) : undefined,
      lastAirDate: input.mediaType === "tv" ? toDate(input.lastAirDate) : undefined,
      year: input.year ?? undefined,
      runtime: input.runtime ?? undefined,
      genres: input.genres === undefined ? undefined : input.genres as object,
      popularity: input.popularity ?? undefined,
      voteAverage: input.voteAverage ?? undefined,
      voteCount: input.voteCount ?? undefined,
      numberOfSeasons: input.numberOfSeasons ?? undefined,
      numberOfEpisodes: input.numberOfEpisodes ?? undefined,
      originalLanguage: input.originalLanguage ?? undefined,
      sourcePayload: input.rawPayload === undefined ? undefined : input.rawPayload as object,
      cacheStatus: input.cacheStatus ?? "hit",
      source: "trakt",
      sourceVersion: SOURCE_VERSION,
      lastFetchedAt: now,
      expiresAt: cacheUntil,
      staleAt: cacheStaleAt,
      lastSyncedAt: now,
    },
    create: {
      tmdbId,
      traktId,
      imdbId,
      slug: input.ids.slug ?? null,
      mediaType: input.mediaType,
      title: input.title,
      originalTitle: input.originalTitle ?? input.title,
      overview: input.overview ?? null,
      posterPath: normalizeImage(input.posterUrl),
      backdropPath: normalizeImage(input.backdropUrl),
      releaseDate: input.mediaType === "movie" ? toDate(input.releaseDate) : null,
      firstAirDate: input.mediaType === "tv" ? toDate(input.firstAirDate ?? input.releaseDate) : null,
      lastAirDate: input.mediaType === "tv" ? toDate(input.lastAirDate) : null,
      year: input.year ?? null,
      runtime: input.runtime ?? null,
      genres: input.genres as object ?? undefined,
      popularity: input.popularity ?? null,
      voteAverage: input.voteAverage ?? null,
      voteCount: input.voteCount ?? null,
      numberOfSeasons: input.numberOfSeasons ?? null,
      numberOfEpisodes: input.numberOfEpisodes ?? null,
      originalLanguage: input.originalLanguage ?? null,
      sourcePayload: input.rawPayload as object ?? undefined,
      cacheStatus: input.cacheStatus ?? "miss",
      source: "trakt",
      sourceVersion: SOURCE_VERSION,
      lastFetchedAt: now,
      expiresAt: cacheUntil,
      staleAt: cacheStaleAt,
      lastSyncedAt: now,
    },
  });

  await db.titleExternalId.upsert({
    where: { tmdbId_mediaType: { tmdbId, mediaType: input.mediaType } },
    update: {
      imdbId,
      tvdbId: input.ids.tvdbId == null ? undefined : String(input.ids.tvdbId),
      traktId: input.ids.traktId == null ? undefined : String(input.ids.traktId),
    },
    create: {
      tmdbId,
      mediaType: input.mediaType,
      imdbId,
      tvdbId: input.ids.tvdbId == null ? null : String(input.ids.tvdbId),
      traktId: input.ids.traktId == null ? null : String(input.ids.traktId),
    },
  }).catch(() => null);

  return row;
}

export async function enqueueCanonicalRefresh(input: {
  kind: string;
  mediaType?: MediaType | null;
  poplogId?: string | null;
  traktId?: number | string | null;
  imdbId?: string | null;
  slug?: string | null;
  priority?: number;
  delaySeconds?: number;
}) {
  const key = [
    input.mediaType ?? "any",
    input.poplogId ?? input.imdbId ?? input.traktId ?? input.slug ?? "unknown",
  ].join(":");
  const runAfter = new Date(Date.now() + (input.delaySeconds ?? 0) * 1_000);

  await db.poplogRefreshQueue.upsert({
    where: { cacheKey_kind: { cacheKey: key, kind: input.kind } },
    update: {
      status: "queued",
      priority: input.priority ?? 100,
      runAfter,
      lastError: null,
    },
    create: {
      cacheKey: key,
      kind: input.kind,
      mediaType: input.mediaType ?? null,
      poplogId: input.poplogId ?? null,
      traktId: traktBigInt(input.traktId),
      imdbId: input.imdbId ?? null,
      slug: input.slug ?? null,
      priority: input.priority ?? 100,
      runAfter,
    },
  }).catch((error) => {
    console.warn("[canonical-store] refresh enqueue failed", error instanceof Error ? error.message : String(error));
  });
}

export function canonicalInputFromSearchResult(
  result: CatalogSearchResult,
  ttlSeconds = 86_400,
): CanonicalTitleInput {
  const mediaType = result.mediaType === "show" ? "tv" : "movie";
  return {
    mediaType,
    title: result.title,
    originalTitle: result.originalTitle ?? result.title,
    overview: result.overview ?? null,
    year: result.year ?? null,
    releaseDate: mediaType === "movie" ? result.releaseDate ?? null : null,
    firstAirDate: mediaType === "tv" ? result.firstAirDate ?? result.releaseDate ?? null : null,
    posterUrl: result.posterPath ?? null,
    backdropUrl: result.backdropPath ?? null,
    genres: result.genres ?? result.genreIds ?? undefined,
    voteAverage: result.voteAverage ?? null,
    voteCount: result.voteCount ?? null,
    ids: {
      traktId: result.ids.traktId,
      imdbId: result.ids.imdbId,
      tmdbId: result.ids.tmdbId,
      tvdbId: result.ids.tvdbId,
      slug: result.ids.slug,
    },
    rawPayload: result,
    ttlSeconds,
  };
}

export function canonicalInputFromCatalogTitle(
  title: CatalogTitle,
  ttlSeconds = 86_400,
): CanonicalTitleInput {
  const mediaType = title.mediaType === "show" ? "tv" : "movie";
  return {
    mediaType,
    title: title.title,
    originalTitle: title.originalTitle ?? title.title,
    overview: title.overview ?? null,
    year: title.year ?? null,
    posterUrl: title.posterPath ?? null,
    backdropUrl: title.backdropPath ?? null,
    runtime: title.runtime ?? null,
    genres: title.genres ?? undefined,
    voteAverage: title.rating ?? null,
    voteCount: title.votes ?? null,
    numberOfSeasons: title.numberOfSeasons ?? null,
    numberOfEpisodes: title.numberOfEpisodes ?? null,
    originalLanguage: title.language ?? null,
    ids: {
      traktId: title.ids.traktId,
      imdbId: title.ids.imdbId,
      tmdbId: title.ids.tmdbId,
      tvdbId: title.ids.tvdbId,
      slug: title.ids.slug,
    },
    rawPayload: title,
    ttlSeconds,
  };
}

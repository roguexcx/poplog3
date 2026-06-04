/**
 * POPLOG-first hydration for external catalog search results.
 *
 * External IDs (TMDB, IMDb, TVDB, Trakt, Balloonerismm) are aliases. The
 * preferred identity is the local Poplog3Title.id when a local row can be
 * resolved. Search-only candidates are not persisted.
 */

import { db } from "@/server/db/client";
import { normalizeSearchTerm } from "@/server/search/fuzzy-title-search";
import type { CatalogSearchResult } from "./types/catalog.types";
import type { PoplogTitle } from "@/server/types/title";

type MediaType = "movie" | "tv";

type ExternalIds = {
  tmdbId?: number;
  imdbId?: string;
  tvdbId?: number;
  traktId?: number | string;
  balloonerismmId?: string;
  slug?: string;
};

export type PoplogCatalogCandidate = {
  poplogId?: string;
  mediaType: MediaType | "person";
  title: string;
  originalTitle?: string;
  overview?: string;
  year?: number;
  releaseDate?: string;
  posterUrl?: string;
  backdropUrl?: string | null;
  genres?: string[];
  genreIds?: number[];
  voteAverage?: number;
  voteCount?: number;
  externalIds: ExternalIds;
  sourceMeta: {
    primarySource: "balloonerismm";
    confidence: number;
  };
};

export type HydratedPoplogTitle = PoplogTitle & {
  poplogId?: string | number | null;
  externalIds?: ExternalIds;
  sourceMeta?: PoplogCatalogCandidate["sourceMeta"];
  genre_names?: string[];
  search_source?: "balloonerismm" | "cache-fuzzy";
  isTemporaryCatalogCandidate?: boolean;
};

export type CatalogIdentityFields = {
  poplogId?: string | number | null;
  externalIds?: ExternalIds;
  identityUsed: string;
  linkIdUsed: string | number;
  hasPoplogId: boolean;
  normalizedFrom: "balloonerismm" | "legacy" | "cache-fuzzy";
  legacyCompatibilityUsed: boolean;
};

export type HydrationDebug = {
  source: "balloonerismm";
  rawCount: number;
  normalizedCount: number;
  poplogResolvedCount: number;
  searchCompatibleCount: number;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  discardReasons: Record<string, number>;
  externalIdStats: {
    imdbId: number;
    tmdbId: number;
    tvdbId: number;
    traktId: number;
    balloonerismmId: number;
    slug: number;
    poplogResolved: number;
    temporaryCandidates: number;
  };
};

type TitleRow = {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string | null;
  originalTitle: string | null;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: Date | null;
  firstAirDate: Date | null;
  lastAirDate: Date | null;
  year: number | null;
  runtime: number | null;
  episodeRunTime: unknown;
  genres: unknown;
  popularity: unknown;
  voteAverage: unknown;
  voteCount: number | null;
  originalLanguage: string | null;
};

function addReason(reasons: Record<string, number>, reason: string): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

function toMediaType(value: CatalogSearchResult["mediaType"]): MediaType {
  return value === "show" ? "tv" : "movie";
}

function dateToYear(value?: string): number | undefined {
  if (!value || !/^\d{4}/.test(value)) return undefined;
  return Number(value.slice(0, 4));
}

function stableSyntheticId(candidate: PoplogCatalogCandidate): number {
  const key = [
    candidate.mediaType,
    candidate.externalIds.imdbId,
    candidate.externalIds.balloonerismmId,
    candidate.externalIds.slug,
    candidate.title,
    candidate.year,
  ].filter(Boolean).join("|");

  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }

  return 1_800_000_000 + (hash % 100_000_000);
}

function candidateKey(candidate: PoplogCatalogCandidate): string {
  if (candidate.poplogId) return `poplog:${candidate.poplogId}`;
  if (candidate.externalIds.imdbId) return `imdb:${candidate.externalIds.imdbId}`;
  if (candidate.externalIds.tmdbId) return `tmdb:${candidate.mediaType}:${candidate.externalIds.tmdbId}`;
  if (candidate.externalIds.slug) return `slug:${candidate.externalIds.slug}`;
  return `title:${candidate.mediaType}:${normalizeSearchTerm(candidate.title)}:${candidate.year ?? ""}`;
}

function normalizeCandidate(result: CatalogSearchResult, reasons: Record<string, number>): PoplogCatalogCandidate | null {
  const mediaType = toMediaType(result.mediaType);
  const title = result.title?.trim();
  if (!title) {
    addReason(reasons, "missing_title");
    return null;
  }

  const releaseDate = mediaType === "movie" ? result.releaseDate : result.firstAirDate ?? result.releaseDate;
  const year = result.year ?? dateToYear(releaseDate);
  const imdbId = result.ids.imdbId?.startsWith("tt") ? result.ids.imdbId : undefined;
  const balloonerismmId = result.ids.balloonerismmId ?? imdbId;

  return {
    mediaType,
    title,
    originalTitle: result.originalTitle,
    overview: result.overview,
    year,
    releaseDate,
    posterUrl: result.posterPath,
    backdropUrl: result.backdropPath ?? null,
    genres: result.genres,
    genreIds: result.genreIds,
    voteAverage: result.voteAverage,
    voteCount: result.voteCount,
    externalIds: {
      tmdbId: result.ids.tmdbId,
      imdbId,
      tvdbId: result.ids.tvdbId,
      traktId: result.ids.traktId,
      balloonerismmId,
      slug: result.ids.slug,
    },
    sourceMeta: {
      primarySource: "balloonerismm",
      confidence: imdbId ? 0.9 : 0.7,
    },
  };
}

function rowToPoplogTitle(row: TitleRow, candidate?: PoplogCatalogCandidate): HydratedPoplogTitle {
  return {
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    title: row.title ?? row.originalTitle ?? candidate?.title ?? "Untitled",
    original_title: row.originalTitle ?? candidate?.originalTitle,
    overview: row.overview ?? candidate?.overview,
    poster_path: row.posterPath ?? candidate?.posterUrl,
    backdrop_path: row.backdropPath ?? candidate?.backdropUrl ?? null,
    release_date: row.mediaType === "movie"
      ? (row.releaseDate?.toISOString().slice(0, 10) ?? candidate?.releaseDate ?? null)
      : null,
    first_air_date: row.mediaType === "tv"
      ? (row.firstAirDate?.toISOString().slice(0, 10) ?? candidate?.releaseDate ?? null)
      : null,
    last_air_date: row.mediaType === "tv" ? (row.lastAirDate?.toISOString().slice(0, 10) ?? null) : null,
    year: row.year ?? candidate?.year ?? null,
    runtime: row.mediaType === "movie" ? row.runtime : null,
    episode_run_time: row.mediaType === "tv" ? (Array.isArray(row.episodeRunTime) ? row.episodeRunTime as number[] : null) : null,
    genres: Array.isArray(row.genres) ? (row.genres as number[]) : candidate?.genreIds ?? [],
    genre_names: candidate?.genres,
    popularity: row.popularity != null ? Number(row.popularity) : null,
    vote_average: row.voteAverage != null ? Number(row.voteAverage) : candidate?.voteAverage ?? null,
    vote_count: row.voteCount ?? candidate?.voteCount ?? null,
    original_language: row.originalLanguage,
    imdb_id: candidate?.externalIds.imdbId,
    poplogId: row.id,
    externalIds: candidate?.externalIds,
    ...resolveCatalogIdentityFields({
      tmdb_id: row.tmdbId,
      media_type: row.mediaType,
      imdb_id: candidate?.externalIds.imdbId,
      poplogId: row.id,
      externalIds: candidate?.externalIds,
    }),
    sourceMeta: candidate?.sourceMeta,
    search_source: "balloonerismm",
  };
}

function candidateToTemporaryTitle(candidate: PoplogCatalogCandidate): HydratedPoplogTitle {
  const syntheticId = stableSyntheticId(candidate);
  const mediaType = candidate.mediaType === "tv" ? "tv" : "movie";

  return {
    tmdb_id: candidate.externalIds.tmdbId ?? syntheticId,
    media_type: mediaType,
    title: candidate.title,
    original_title: candidate.originalTitle ?? null,
    overview: candidate.overview ?? null,
    poster_path: candidate.posterUrl ?? null,
    backdrop_path: candidate.backdropUrl ?? null,
    release_date: mediaType === "movie" ? candidate.releaseDate ?? null : null,
    first_air_date: mediaType === "tv" ? candidate.releaseDate ?? null : null,
    last_air_date: null,
    year: candidate.year ?? null,
    runtime: null,
    episode_run_time: null,
    genres: candidate.genreIds ?? [],
    genre_names: candidate.genres,
    popularity: null,
    vote_average: candidate.voteAverage ?? null,
    vote_count: candidate.voteCount ?? null,
    original_language: null,
    imdb_id: candidate.externalIds.imdbId,
    externalIds: candidate.externalIds,
    ...resolveCatalogIdentityFields({
      tmdb_id: candidate.externalIds.tmdbId ?? syntheticId,
      media_type: mediaType,
      imdb_id: candidate.externalIds.imdbId,
      externalIds: candidate.externalIds,
    }),
    sourceMeta: candidate.sourceMeta,
    search_source: "balloonerismm",
    isTemporaryCatalogCandidate: true,
  };
}

export function resolveCatalogIdentityFields(
  title: Partial<HydratedPoplogTitle> & {
    tmdb_id?: number | null;
    media_type?: MediaType;
  },
  normalizedFrom: CatalogIdentityFields["normalizedFrom"] = "balloonerismm",
): CatalogIdentityFields {
  const externalIds = title.externalIds ?? {
    tmdbId: title.tmdb_id ?? undefined,
    imdbId: title.imdb_id ?? undefined,
  };
  const poplogId = title.poplogId ?? null;
  const linkIdUsed =
    poplogId ??
    externalIds.imdbId ??
    externalIds.balloonerismmId ??
    externalIds.slug ??
    externalIds.tvdbId ??
    externalIds.traktId ??
    externalIds.tmdbId ??
    title.tmdb_id ??
    "";
  const identityUsed = poplogId
    ? "poplog_id"
    : externalIds.imdbId
      ? "imdb_id"
      : externalIds.balloonerismmId
        ? "balloonerismm_id"
        : externalIds.slug
          ? "slug"
          : externalIds.tvdbId
            ? "tvdb_id"
            : externalIds.traktId
              ? "trakt_id"
              : externalIds.tmdbId
                ? "tmdb_id_alias"
                : "temporary_catalog_candidate";

  return {
    poplogId,
    externalIds,
    identityUsed,
    linkIdUsed,
    hasPoplogId: Boolean(poplogId),
    normalizedFrom,
    legacyCompatibilityUsed: Boolean(title.tmdb_id && linkIdUsed !== title.tmdb_id),
  };
}

async function resolveRows(candidates: PoplogCatalogCandidate[]): Promise<Map<string, TitleRow>> {
  const imdbIds = candidates
    .map((candidate) => candidate.externalIds.imdbId)
    .filter((id): id is string => Boolean(id));
  const tmdbPairs = candidates
    .filter((candidate) => candidate.externalIds.tmdbId)
    .map((candidate) => ({ tmdbId: candidate.externalIds.tmdbId!, mediaType: candidate.mediaType as MediaType }));
  const tvdbIds = candidates
    .map((candidate) => candidate.externalIds.tvdbId)
    .filter((id): id is number => typeof id === "number");
  const traktIds = candidates
    .map((candidate) => candidate.externalIds.traktId)
    .filter((id): id is number | string => id !== undefined && id !== null)
    .map(String);

  const externalOr = [
    imdbIds.length ? { imdbId: { in: imdbIds } } : null,
    tvdbIds.length ? { tvdbId: { in: tvdbIds.map(String) } } : null,
    traktIds.length ? { traktId: { in: traktIds } } : null,
    ...tmdbPairs.map(({ tmdbId, mediaType }) => ({ tmdbId, mediaType })),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  const externalRows = externalOr.length
    ? await db.titleExternalId.findMany({
        where: { OR: externalOr },
        select: { imdbId: true, tmdbId: true, mediaType: true, tvdbId: true, traktId: true },
      }).catch(() => [])
    : [];

  const titlePairs = new Map<string, { tmdbId: number; mediaType: MediaType }>();
  for (const row of externalRows) {
    const mediaType = row.mediaType as MediaType;
    titlePairs.set(`${mediaType}-${row.tmdbId}`, { tmdbId: row.tmdbId, mediaType });
  }
  for (const pair of tmdbPairs) {
    titlePairs.set(`${pair.mediaType}-${pair.tmdbId}`, pair);
  }

  const titleOr = [
    ...Array.from(titlePairs.values()).map(({ tmdbId, mediaType }) => ({ tmdbId, mediaType })),
    ...candidates.map((candidate) => ({
      mediaType: candidate.mediaType as MediaType,
      title: candidate.title,
      year: candidate.year,
    })).filter((where) => where.year !== undefined),
  ];

  const rows = titleOr.length
    ? await db.poplog3Title.findMany({
        where: { OR: titleOr },
        select: {
          id: true,
          tmdbId: true,
          mediaType: true,
          title: true,
          originalTitle: true,
          overview: true,
          posterPath: true,
          backdropPath: true,
          releaseDate: true,
          firstAirDate: true,
          lastAirDate: true,
          year: true,
          runtime: true,
          episodeRunTime: true,
          genres: true,
          popularity: true,
          voteAverage: true,
          voteCount: true,
          originalLanguage: true,
        },
      }).catch(() => [])
    : [];

  const rowsByKey = new Map<string, TitleRow>();
  for (const row of rows as TitleRow[]) {
    rowsByKey.set(`${row.mediaType}-${row.tmdbId}`, row);
    if (row.title && row.year) {
      rowsByKey.set(`title:${row.mediaType}:${normalizeSearchTerm(row.title)}:${row.year}`, row);
    }
    if (row.originalTitle && row.year) {
      rowsByKey.set(`title:${row.mediaType}:${normalizeSearchTerm(row.originalTitle)}:${row.year}`, row);
    }
  }

  for (const external of externalRows) {
    const key = `${external.mediaType}-${external.tmdbId}`;
    const row = rowsByKey.get(key);
    if (!row) continue;
    if (external.imdbId) rowsByKey.set(`imdb:${external.imdbId}`, row);
    if (external.tvdbId) rowsByKey.set(`tvdb:${external.tvdbId}`, row);
    if (external.traktId) rowsByKey.set(`trakt:${external.traktId}`, row);
  }

  return rowsByKey;
}

export async function hydrateCatalogResultsWithDebug(
  results: CatalogSearchResult[],
): Promise<{ titles: HydratedPoplogTitle[]; debug: HydrationDebug }> {
  const discardReasons: Record<string, number> = {};
  const candidates = results
    .map((result) => normalizeCandidate(result, discardReasons))
    .filter((candidate): candidate is PoplogCatalogCandidate => Boolean(candidate));

  const rowsByKey = await resolveRows(candidates);
  const seen = new Set<string>();
  let poplogResolvedCount = 0;

  const titles: HydratedPoplogTitle[] = [];
  for (const candidate of candidates) {
    const row =
      (candidate.externalIds.imdbId ? rowsByKey.get(`imdb:${candidate.externalIds.imdbId}`) : undefined) ??
      (candidate.externalIds.tmdbId ? rowsByKey.get(`${candidate.mediaType}-${candidate.externalIds.tmdbId}`) : undefined) ??
      (candidate.externalIds.tvdbId ? rowsByKey.get(`tvdb:${candidate.externalIds.tvdbId}`) : undefined) ??
      (candidate.externalIds.traktId ? rowsByKey.get(`trakt:${candidate.externalIds.traktId}`) : undefined) ??
      (candidate.year ? rowsByKey.get(`title:${candidate.mediaType}:${normalizeSearchTerm(candidate.title)}:${candidate.year}`) : undefined);

    const title = row ? rowToPoplogTitle(row, candidate) : candidateToTemporaryTitle(candidate);
    const key = row ? `poplog:${row.id}` : candidateKey(candidate);
    if (seen.has(key)) {
      addReason(discardReasons, "duplicate");
      continue;
    }
    seen.add(key);

    if (!title.poster_path) {
      addReason(discardReasons, "missing_poster");
      continue;
    }

    if (row) poplogResolvedCount += 1;
    titles.push(title);
  }

  const debug: HydrationDebug = {
    source: "balloonerismm",
    rawCount: results.length,
    normalizedCount: candidates.length,
    poplogResolvedCount,
    searchCompatibleCount: titles.length,
    fallbackUsed: false,
    fallbackReason: null,
    discardReasons,
    externalIdStats: {
      imdbId: candidates.filter((candidate) => Boolean(candidate.externalIds.imdbId)).length,
      tmdbId: candidates.filter((candidate) => Boolean(candidate.externalIds.tmdbId)).length,
      tvdbId: candidates.filter((candidate) => Boolean(candidate.externalIds.tvdbId)).length,
      traktId: candidates.filter((candidate) => Boolean(candidate.externalIds.traktId)).length,
      balloonerismmId: candidates.filter((candidate) => Boolean(candidate.externalIds.balloonerismmId)).length,
      slug: candidates.filter((candidate) => Boolean(candidate.externalIds.slug)).length,
      poplogResolved: poplogResolvedCount,
      temporaryCandidates: titles.filter((title) => title.isTemporaryCatalogCandidate).length,
    },
  };

  return { titles, debug };
}

export async function hydrateCatalogResults(
  results: CatalogSearchResult[],
): Promise<HydratedPoplogTitle[]> {
  const { titles } = await hydrateCatalogResultsWithDebug(results);
  return titles;
}

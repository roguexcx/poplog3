/**
 * POPLOG-first hydration for Trakt catalog results.
 *
 * Every relevant result is normalized, persisted as a canonical local record,
 * and only then returned to public surfaces. Trakt IDs and TMDB IDs are external
 * aliases; POPLOG identity is the local `poplog3_titles.id`.
 */

import { db } from "@/server/db/client";
import { normalizeSearchTerm } from "@/server/search/fuzzy-title-search";
import type { CatalogSearchResult } from "./types/catalog.types";
import type { PoplogTitle } from "@/server/types/title";
import {
  canonicalInputFromSearchResult,
  upsertCanonicalTitle,
} from "./canonical-store";

type MediaType = "movie" | "tv";

type ExternalIds = {
  tmdbId?: number;
  imdbId?: string;
  tvdbId?: number;
  traktId?: number | string;
  slug?: string;
};

export type HydratedPoplogTitle = PoplogTitle & {
  poplogId?: string | number | null;
  externalIds?: ExternalIds;
  sourceMeta?: {
    primarySource: "trakt";
    confidence: number;
  };
  genre_names?: string[];
  search_source?: "trakt" | "cache-fuzzy" | "trakt_index";
  isTemporaryCatalogCandidate?: boolean;
};

export type CatalogIdentityFields = {
  poplogId?: string | number | null;
  externalIds?: ExternalIds;
  identityUsed: string;
  linkIdUsed: string | number;
  hasPoplogId: boolean;
  normalizedFrom: "trakt" | "trakt_index" | "legacy" | "cache-fuzzy";
  legacyCompatibilityUsed: boolean;
};

export type HydrationDebug = {
  source: "trakt";
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
    slug: number;
    poplogResolved: number;
    temporaryCandidates: number;
  };
};

type TitleRow = {
  id: string;
  tmdbId: number;
  traktId: bigint | null;
  imdbId: string | null;
  slug: string | null;
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
  cacheStatus: string;
  lastFetchedAt: Date | null;
  expiresAt: Date | null;
};

type Candidate = {
  mediaType: MediaType;
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

function normalizeCandidate(result: CatalogSearchResult, reasons: Record<string, number>): Candidate | null {
  const mediaType = toMediaType(result.mediaType);
  const title = result.title?.trim();
  if (!title) {
    addReason(reasons, "missing_title");
    return null;
  }

  const releaseDate = mediaType === "movie" ? result.releaseDate : result.firstAirDate ?? result.releaseDate;
  const year = result.year ?? dateToYear(releaseDate);
  const imdbId = result.ids.imdbId?.startsWith("tt") ? result.ids.imdbId : undefined;

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
      slug: result.ids.slug,
    },
  };
}

function titleKey(candidate: Candidate): string {
  if (candidate.externalIds.imdbId) return `imdb:${candidate.externalIds.imdbId}`;
  if (candidate.externalIds.traktId) return `trakt:${candidate.externalIds.traktId}`;
  if (candidate.externalIds.tmdbId) return `tmdb:${candidate.mediaType}:${candidate.externalIds.tmdbId}`;
  if (candidate.externalIds.slug) return `slug:${candidate.mediaType}:${candidate.externalIds.slug}`;
  return `title:${candidate.mediaType}:${normalizeSearchTerm(candidate.title)}:${candidate.year ?? ""}`;
}

export function resolveCatalogIdentityFields(
  title: Partial<HydratedPoplogTitle> & {
    tmdb_id?: number | null;
    media_type?: MediaType;
  },
  normalizedFrom: CatalogIdentityFields["normalizedFrom"] = "trakt",
): CatalogIdentityFields {
  const externalIds = title.externalIds ?? {
    tmdbId: title.tmdb_id ?? undefined,
    imdbId: title.imdb_id ?? undefined,
  };
  const poplogId = title.poplogId ?? null;
  const linkIdUsed =
    poplogId ??
    externalIds.imdbId ??
    externalIds.slug ??
    externalIds.traktId ??
    externalIds.tmdbId ??
    title.tmdb_id ??
    "";
  const identityUsed = poplogId
    ? "poplog_id"
    : externalIds.imdbId
      ? "imdb_id"
      : externalIds.slug
        ? "slug"
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

function rowToPoplogTitle(row: TitleRow, candidate?: Candidate): HydratedPoplogTitle {
  const externalIds: ExternalIds = {
    ...(row.tmdbId ? { tmdbId: row.tmdbId } : {}),
    ...(row.imdbId ?? candidate?.externalIds.imdbId ? { imdbId: row.imdbId ?? candidate?.externalIds.imdbId } : {}),
    ...(row.traktId ? { traktId: row.traktId.toString() } : candidate?.externalIds.traktId ? { traktId: candidate.externalIds.traktId } : {}),
    ...(candidate?.externalIds.tvdbId ? { tvdbId: candidate.externalIds.tvdbId } : {}),
    ...(row.slug ?? candidate?.externalIds.slug ? { slug: row.slug ?? candidate?.externalIds.slug } : {}),
  };

  const payload: HydratedPoplogTitle = {
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
    imdb_id: externalIds.imdbId,
    poplogId: row.id,
    externalIds,
    sourceMeta: { primarySource: "trakt", confidence: externalIds.imdbId ? 0.95 : 0.8 },
    search_source: "trakt",
    isTemporaryCatalogCandidate: false,
  };

  return {
    ...payload,
    ...resolveCatalogIdentityFields(payload, "trakt"),
  };
}

async function selectRowsForCandidates(candidates: Candidate[]): Promise<Map<string, TitleRow>> {
  const or = candidates.flatMap((candidate) => {
    const clauses: Array<Record<string, unknown>> = [];
    if (candidate.externalIds.imdbId) clauses.push({ imdbId: candidate.externalIds.imdbId, mediaType: candidate.mediaType });
    if (candidate.externalIds.traktId) clauses.push({ traktId: BigInt(String(candidate.externalIds.traktId)), mediaType: candidate.mediaType });
    if (candidate.externalIds.tmdbId) clauses.push({ tmdbId: candidate.externalIds.tmdbId, mediaType: candidate.mediaType });
    if (candidate.externalIds.slug) clauses.push({ slug: candidate.externalIds.slug, mediaType: candidate.mediaType });
    if (candidate.year) clauses.push({ mediaType: candidate.mediaType, title: candidate.title, year: candidate.year });
    return clauses;
  });

  const rows = or.length
    ? await db.poplog3Title.findMany({
        where: { OR: or },
        select: {
          id: true,
          tmdbId: true,
          traktId: true,
          imdbId: true,
          slug: true,
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
          cacheStatus: true,
          lastFetchedAt: true,
          expiresAt: true,
        },
      }).catch(() => [])
    : [];

  const map = new Map<string, TitleRow>();
  for (const row of rows as TitleRow[]) {
    map.set(`poplog:${row.id}`, row);
    map.set(`tmdb:${row.mediaType}:${row.tmdbId}`, row);
    if (row.imdbId) map.set(`imdb:${row.imdbId}`, row);
    if (row.traktId) map.set(`trakt:${row.traktId.toString()}`, row);
    if (row.slug) map.set(`slug:${row.mediaType}:${row.slug}`, row);
    if (row.title && row.year) map.set(`title:${row.mediaType}:${normalizeSearchTerm(row.title)}:${row.year}`, row);
    if (row.originalTitle && row.year) map.set(`title:${row.mediaType}:${normalizeSearchTerm(row.originalTitle)}:${row.year}`, row);
  }

  return map;
}

function rowForCandidate(rows: Map<string, TitleRow>, candidate: Candidate): TitleRow | undefined {
  return (
    (candidate.externalIds.imdbId ? rows.get(`imdb:${candidate.externalIds.imdbId}`) : undefined) ??
    (candidate.externalIds.traktId ? rows.get(`trakt:${candidate.externalIds.traktId}`) : undefined) ??
    (candidate.externalIds.tmdbId ? rows.get(`tmdb:${candidate.mediaType}:${candidate.externalIds.tmdbId}`) : undefined) ??
    (candidate.externalIds.slug ? rows.get(`slug:${candidate.mediaType}:${candidate.externalIds.slug}`) : undefined) ??
    (candidate.year ? rows.get(`title:${candidate.mediaType}:${normalizeSearchTerm(candidate.title)}:${candidate.year}`) : undefined)
  );
}

export async function hydrateCatalogResultsWithDebug(
  results: CatalogSearchResult[],
): Promise<{ titles: HydratedPoplogTitle[]; debug: HydrationDebug }> {
  const discardReasons: Record<string, number> = {};
  const candidates = results
    .map((result) => normalizeCandidate(result, discardReasons))
    .filter((candidate): candidate is Candidate => Boolean(candidate));

  await Promise.allSettled(
    results.map((result) => upsertCanonicalTitle(canonicalInputFromSearchResult(result, 86_400))),
  );

  const rowsByKey = await selectRowsForCandidates(candidates);
  const seen = new Set<string>();
  let poplogResolvedCount = 0;
  const titles: HydratedPoplogTitle[] = [];

  for (const candidate of candidates) {
    const row = rowForCandidate(rowsByKey, candidate);
    if (!row) {
      addReason(discardReasons, "canonical_upsert_missing");
      continue;
    }

    const title = rowToPoplogTitle(row, candidate);
    const key = `poplog:${row.id}`;
    if (seen.has(key) || seen.has(titleKey(candidate))) {
      addReason(discardReasons, "duplicate");
      continue;
    }
    seen.add(key);
    seen.add(titleKey(candidate));

    if (!title.poster_path) {
      addReason(discardReasons, "missing_poster");
      continue;
    }

    poplogResolvedCount += 1;
    titles.push(title);
  }

  const debug: HydrationDebug = {
    source: "trakt",
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
      slug: candidates.filter((candidate) => Boolean(candidate.externalIds.slug)).length,
      poplogResolved: poplogResolvedCount,
      temporaryCandidates: titles.filter((title) => title.isTemporaryCatalogCandidate).length,
    },
  };

  const mediaCounts = candidates.reduce(
    (acc, candidate) => {
      if (candidate.mediaType === "tv") acc.tv += 1;
      if (candidate.mediaType === "movie") acc.movie += 1;
      return acc;
    },
    { movie: 0, tv: 0 },
  );
  console.log(
    `[catalog] hydrate source=trakt raw=${debug.rawCount} normalized=${debug.normalizedCount} returned=${debug.searchCompatibleCount} tv=${mediaCounts.tv} movie=${mediaCounts.movie} poplog=${debug.poplogResolvedCount} temp=${debug.externalIdStats.temporaryCandidates} discarded=${Object.entries(discardReasons).map(([key, value]) => `${key}:${value}`).join(",") || "none"}`,
  );

  return { titles, debug };
}

export async function hydrateCatalogResults(
  results: CatalogSearchResult[],
): Promise<HydratedPoplogTitle[]> {
  const { titles } = await hydrateCatalogResultsWithDebug(results);
  return titles;
}

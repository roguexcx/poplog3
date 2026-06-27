import { db } from "@/server/db/client";
import type { PoplogTitle } from "@/server/types/title";
import { resolveCatalogLocalization } from "@/lib/i18n/catalog-localization";
import { getCatalogLocalizationsByPoplogId } from "@/server/catalog/catalog-localization-store";

type SearchMediaType = "all" | "movie" | "tv";

type CachedTitleRow = {
  id: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
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

export type FuzzyTitleMatch = PoplogTitle & {
  search_similarity: number;
  search_score: number;
  search_source: "cache-fuzzy";
};

const MAX_CACHE_CANDIDATES = 600;
const MAX_FUZZY_RESULTS = 8;
const MIN_SIMILARITY = 0.8;
const STRONG_SIMILARITY = 0.82;

export function normalizeSearchTerm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[''`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function titleFromRow(row: CachedTitleRow, language?: string | null): Promise<PoplogTitle> {
  const localizations = await getCatalogLocalizationsByPoplogId(row.id).catch(() => []);
  const resolved = resolveCatalogLocalization(
    {
      title: row.title,
      originalTitle: row.originalTitle,
      overview: row.overview,
      localizations,
    },
    language,
  );
  return {
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    title: resolved.title ?? row.title ?? row.originalTitle ?? "Untitled",
    original_title: row.originalTitle,
    overview: resolved.overview ?? row.overview,
    poster_path: row.posterPath,
    backdrop_path: row.backdropPath,
    release_date: row.releaseDate?.toISOString().slice(0, 10) ?? null,
    first_air_date: row.firstAirDate?.toISOString().slice(0, 10) ?? null,
    last_air_date: row.lastAirDate?.toISOString().slice(0, 10) ?? null,
    year: row.year,
    runtime: row.runtime,
    episode_run_time: Array.isArray(row.episodeRunTime) ? row.episodeRunTime as number[] : null,
    genres: Array.isArray(row.genres) ? row.genres as number[] : [],
    popularity: row.popularity === null ? null : Number(row.popularity),
    vote_average: row.voteAverage === null ? null : Number(row.voteAverage),
    vote_count: row.voteCount,
    original_language: row.originalLanguage,
    poplogId: row.id,
    localized: {
      [resolved.language]: {
        title: resolved.title,
        overview: resolved.overview,
        tagline: resolved.tagline,
      },
    },
  };
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;

      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      );
    }

    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

function editSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;

  return 1 - levenshteinDistance(a, b) / longest;
}

function tokenSimilarity(query: string, candidate: string): number {
  const queryTokens = query.split(" ").filter(Boolean);
  const candidateTokens = candidate.split(" ").filter(Boolean);

  if (!queryTokens.length || !candidateTokens.length) return 0;

  const matchedScores = queryTokens.map((queryToken) => {
    const bestTokenScore = candidateTokens.reduce((best, candidateToken) => {
      if (queryToken === candidateToken) return 1;
      if (queryToken.length >= 3 && candidateToken.startsWith(queryToken)) {
        return Math.max(best, 0.9);
      }

      if (
        candidateToken.length >= 4 &&
        queryToken.startsWith(candidateToken) &&
        candidateToken.length / queryToken.length >= 0.65
      ) {
        return Math.max(best, 0.84);
      }

      return Math.max(best, editSimilarity(queryToken, candidateToken));
    }, 0);

    return bestTokenScore;
  });

  const average =
    matchedScores.reduce((total, score) => total + score, 0) / matchedScores.length;
  const coverage = Math.min(1, queryTokens.length / candidateTokens.length);

  return average * (0.78 + coverage * 0.22);
}

function textualSimilarity(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (query === candidate) return 1;

  const editScore = editSimilarity(query, candidate);
  const tokenScore = tokenSimilarity(query, candidate);

  if (candidate.includes(query)) {
    return Math.max(tokenScore, query.length >= 4 ? 0.88 : 0.8);
  }

  if (query.includes(candidate)) {
    return Math.max(tokenScore, candidate.length >= 4 ? 0.84 : 0.76);
  }

  return Math.max(editScore, tokenScore);
}

function candidateSimilarity(query: string, title: PoplogTitle): number {
  const candidates = [title.title, title.original_title]
    .map((value) => normalizeSearchTerm(value ?? ""))
    .filter(Boolean);

  return candidates.reduce(
    (best, candidate) => Math.max(best, textualSimilarity(query, candidate)),
    0
  );
}

function scoreMatch(title: PoplogTitle, similarity: number, preferredType: SearchMediaType) {
  const popularity = Math.log10(Math.max(title.popularity ?? 0, 0) + 1) / 4;
  const typeBoost =
    preferredType === "all" || preferredType === title.media_type ? 0.08 : -0.12;

  return similarity * 0.82 + Math.min(popularity, 1) * 0.1 + typeBoost;
}

function isStrongEnough(query: string, similarity: number): boolean {
  if (similarity >= STRONG_SIMILARITY) return true;
  if (query.length <= 5) return similarity >= 0.86;
  return similarity >= MIN_SIMILARITY;
}

export async function findCachedFuzzyTitles({
  query,
  mediaType,
  genre,
  excludeKeys = new Set<string>(),
  language,
}: {
  query: string;
  mediaType: SearchMediaType;
  genre?: number;
  excludeKeys?: Set<string>;
  language?: string | null;
}): Promise<FuzzyTitleMatch[]> {
  const normalizedQuery = normalizeSearchTerm(query);

  if (normalizedQuery.length < 3) return [];

  let data: CachedTitleRow[];
  try {
    data = await db.poplog3Title.findMany({
      where: {
        mediaType: mediaType === "all" ? undefined : mediaType,
        posterPath: { not: null },
      },
      orderBy: {
        popularity: "desc",
      },
      take: MAX_CACHE_CANDIDATES,
    }) as CachedTitleRow[];
  } catch {
    return [];
  }

  const titles = await Promise.all(data.map((row) => titleFromRow(row, language)));

  return titles
    .filter((title) => {
      if (excludeKeys.has(`${title.media_type}-${title.tmdb_id}`)) return false;
      if (genre && !(title.genres ?? []).includes(genre)) return false;
      return true;
    })
    .map((title) => {
      const similarity = candidateSimilarity(normalizedQuery, title);

      return {
        ...title,
        search_similarity: similarity,
        search_score: scoreMatch(title, similarity, mediaType),
        search_source: "cache-fuzzy" as const,
      };
    })
    .filter((title) => isStrongEnough(normalizedQuery, title.search_similarity))
    .sort((a, b) => b.search_score - a.search_score)
    .slice(0, MAX_FUZZY_RESULTS);
}

export function shouldUseFuzzyFallback(resultCount: number, page: number): boolean {
  return page === 1 && resultCount < 4;
}

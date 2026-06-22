import type { TMDBItem, TMDBDetails } from "@/types/tmdb";
import { catalogGetMovie, catalogGetShow, catalogGetTrending } from "@/server/source-engine/engine";
import { hydrateCatalogResultsWithDebug } from "@/server/source-engine/hydrate-catalog-results";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { filterOutLibraryItems } from "@/lib/discovery/library-filter";
import { db } from "@/server/db/client";
import { isTraktIndexEnabled } from "@/lib/trakt-index/engine";
import { getPoplogDailyTrendingIndex } from "@/lib/trakt-index/canonical";
import type { TraktIndexItem } from "@/lib/trakt-index/types";

export type { TMDBDetails };

async function localPopularQuery(mediaType: "movie" | "tv", limit: number): Promise<TMDBItem[]> {
  const rows = await db.poplog3Title.findMany({
    where: { mediaType, posterPath: { not: null } },
    orderBy: { popularity: "desc" },
    take: limit,
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
      voteAverage: true,
      popularity: true,
      imdbId: true,
    },
  });

  return rows
    .filter((row) => row.title ?? row.originalTitle)
    .map((row): TMDBItem => {
      const imdbId = row.imdbId ?? undefined;
      return {
        id: row.tmdbId,
        media_type: row.mediaType as "movie" | "tv",
        title: row.title ?? row.originalTitle ?? "",
        original_title: row.originalTitle ?? undefined,
        overview: row.overview ?? undefined,
        poster_path: row.posterPath,
        backdrop_path: row.backdropPath ?? undefined,
        release_date: row.mediaType === "movie" ? (row.releaseDate?.toISOString().slice(0, 10) ?? undefined) : undefined,
        first_air_date: row.mediaType === "tv" ? (row.firstAirDate?.toISOString().slice(0, 10) ?? undefined) : undefined,
        last_air_date: row.mediaType === "tv" ? (row.lastAirDate?.toISOString().slice(0, 10) ?? undefined) : undefined,
        vote_average: row.voteAverage != null ? Number(row.voteAverage) : undefined,
        popularity: row.popularity != null ? Number(row.popularity) : undefined,
        poplogId: row.id,
        externalIds: { tmdbId: row.tmdbId, ...(imdbId ? { imdbId } : {}) },
        identityUsed: "poplog_id",
        linkIdUsed: row.id,
        hasPoplogId: true,
        normalizedFrom: "legacy",
        legacyCompatibilityUsed: false,
      };
    });
}

function traktIndexToTMDBItem(item: TraktIndexItem): TMDBItem {
  return {
    id: item.tmdb_id,
    poplogId: null,
    externalIds: item.externalIds,
    identityUsed: item.identityUsed,
    linkIdUsed: item.linkIdUsed,
    hasPoplogId: false,
    normalizedFrom: item.normalizedFrom,
    legacyCompatibilityUsed: true,
    media_type: item.media_type,
    title: item.title,
    original_title: item.original_title ?? undefined,
    overview: item.overview ?? undefined,
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path ?? undefined,
    release_date: item.release_date ?? undefined,
    first_air_date: item.first_air_date ?? undefined,
    vote_average: item.vote_average ?? undefined,
    popularity: item.popularity ?? undefined,
    // Gêneros em string[] do Trakt (ex: ["drama","thriller"]) — usados como fallback no Hero
    genres: item.genres.length > 0 ? item.genres : undefined,
  };
}

export async function getTrending(userId?: string | null): Promise<TMDBItem[]> {
  // ── Trakt Index (fonte primária) ──────────────────────────────────────────
  if (isTraktIndexEnabled()) {
    try {
      const traktItems: TraktIndexItem[] = await getPoplogDailyTrendingIndex();
      if (traktItems.length >= 3) {
        const results = traktItems.map(traktIndexToTMDBItem);
        return filterOutLibraryItems(userId, results);
      }
    } catch {
      // fall through to Trakt adapter/local
    }
  }

  // ── Trakt adapter fallback ────────────────────────────────────────────────
  try {
    const [movieResults, tvResults] = await Promise.all([
      catalogGetTrending({ mediaType: "movie", limit: 25 }),
      catalogGetTrending({ mediaType: "show", limit: 25 }),
    ]);
    const [movieHydrated, tvHydrated] = await Promise.all([
      hydrateCatalogResultsWithDebug(movieResults),
      hydrateCatalogResultsWithDebug(tvResults),
    ]);
    const merged = [...movieHydrated.titles, ...tvHydrated.titles];
    const valid = filterValidTitles(merged);

    if (valid.length >= 3) {
      const results = valid.map((t): TMDBItem => ({
        id: t.tmdb_id,
        poplogId: t.poplogId,
        externalIds: t.externalIds,
        identityUsed: t.identityUsed,
        linkIdUsed: t.linkIdUsed,
        hasPoplogId: t.hasPoplogId,
        normalizedFrom: t.normalizedFrom,
        legacyCompatibilityUsed: t.legacyCompatibilityUsed,
        media_type: t.media_type,
        title: t.title,
        original_title: t.original_title ?? undefined,
        overview: t.overview ?? undefined,
        poster_path: t.poster_path,
        backdrop_path: t.backdrop_path,
        release_date: t.release_date ?? undefined,
        first_air_date: t.first_air_date ?? undefined,
        last_air_date: t.last_air_date ?? undefined,
        vote_average: t.vote_average ?? undefined,
        popularity: t.popularity ?? undefined,
      }));
      return filterOutLibraryItems(userId, results);
    }
  } catch {
    // fall through to local fallback
  }

  // ── Local DB fallback ─────────────────────────────────────────────────────
  try {
    const movies = await localPopularQuery("movie", 25);
    const tv = await localPopularQuery("tv", 25);
    return filterOutLibraryItems(userId, [...movies, ...tv]);
  } catch {
    return [];
  }
}

export async function getPopularMovies(userId?: string | null): Promise<TMDBItem[]> {
  try {
    const results = await localPopularQuery("movie", 20);
    return filterOutLibraryItems(userId, results);
  } catch {
    return [];
  }
}

export async function getPopularTV(userId?: string | null): Promise<TMDBItem[]> {
  try {
    const results = await localPopularQuery("tv", 20);
    return filterOutLibraryItems(userId, results);
  } catch {
    return [];
  }
}

export async function getFeaturedDetails(
  mediaType: "movie" | "tv",
  item: TMDBItem,
): Promise<TMDBDetails | null> {
  const imdbId = item.externalIds?.imdbId;
  const traktId = typeof item.externalIds?.traktId === "number" ? item.externalIds.traktId : undefined;
  const traktSlug = item.externalIds?.slug;
  if (!imdbId && !traktId && !traktSlug) return null;

  try {
    const data = mediaType === "tv"
      ? await catalogGetShow({ imdbId, traktId, traktSlug }).catch(() => null)
      : await catalogGetMovie({ imdbId, traktId, traktSlug }).catch(() => null);

    if (!data) return null;

    const genres = data.genres?.length
      ? data.genres.map((name, i): { id: number; name: string } => ({ id: -(i + 1), name }))
      : undefined;

    return {
      id: item.id,
      overview: data.overview ?? undefined,
      genres,
      number_of_seasons: data.numberOfSeasons ?? undefined,
      runtime: data.runtime ?? undefined,
      episode_run_time: data.runtime ? [data.runtime] : undefined,
      release_date: item.release_date,
      first_air_date: item.first_air_date,
    };
  } catch {
    return null;
  }
}

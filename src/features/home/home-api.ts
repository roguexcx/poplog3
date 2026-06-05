import type { TMDBItem, TMDBDetails } from "@/types/tmdb";
import { catalogGetTrending } from "@/server/source-engine/engine";
import { hydrateCatalogResultsWithDebug } from "@/server/source-engine/hydrate-catalog-results";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { db } from "@/server/db/client";
import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";

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
      tmdbPayload: true,
    },
  });

  return rows
    .filter((row) => row.title ?? row.originalTitle)
    .map((row): TMDBItem => {
      const payload = row.tmdbPayload as { imdb_id?: string | null } | null;
      const imdbId = payload?.imdb_id ?? undefined;
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

export async function getTrending(): Promise<TMDBItem[]> {
  try {
    const [movieResults, tvResults] = await Promise.all([
      catalogGetTrending({ mediaType: "movie", limit: 10 }),
      catalogGetTrending({ mediaType: "show", limit: 10 }),
    ]);
    const [movieHydrated, tvHydrated] = await Promise.all([
      hydrateCatalogResultsWithDebug(movieResults),
      hydrateCatalogResultsWithDebug(tvResults),
    ]);
    const merged = [...movieHydrated.titles, ...tvHydrated.titles];
    const valid = filterValidTitles(merged);

    if (valid.length >= 3) {
      return valid.map((t): TMDBItem => ({
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
    }
  } catch {
    // fall through to local fallback
  }

  // Local DB fallback
  try {
    return await localPopularQuery("movie", 10)
      .then(async (movies) => {
        const tv = await localPopularQuery("tv", 10);
        return [...movies, ...tv];
      });
  } catch {
    return [];
  }
}

export async function getPopularMovies(): Promise<TMDBItem[]> {
  try {
    return await localPopularQuery("movie", 20);
  } catch {
    return [];
  }
}

export async function getPopularTV(): Promise<TMDBItem[]> {
  try {
    return await localPopularQuery("tv", 20);
  } catch {
    return [];
  }
}

// Busca overview em pt-BR para o item em destaque do hero.
// Usa o endpoint TMDB-proxied do Balloonerismm (/discover/movie ou /tv com filtro de ID),
// ou o endpoint de detalhe com language=pt-BR.
// Não afeta trending — é uma chamada única apenas para o item featured.
export async function getFeaturedDetails(
  mediaType: "movie" | "tv",
  item: TMDBItem,
): Promise<TMDBDetails | null> {
  const imdbId = item.externalIds?.imdbId;
  if (!imdbId) return null;

  try {
    const path = mediaType === "tv" ? `/tv/${imdbId}` : `/movie/${imdbId}`;
    const data = await balloonerismGet<{
      overview?: string | null;
      title?: string | null;
      name?: string | null;
      number_of_seasons?: number | null;
      runtime?: number | null;
      episode_run_time?: number[] | null;
      genres?: string[] | null;
      release_date?: string | null;
      first_air_date?: string | null;
      last_air_date?: string | null;
    }>(path, {
      params: { language: "pt-BR" },
      ttlSeconds: 86400,
    });

    if (!data) return null;

    const genres = data.genres
      ? data.genres.map((name, i) => ({ id: -(i + 1), name }))
      : undefined;

    return {
      id: item.id,
      overview: data.overview ?? undefined,
      genres,
      number_of_seasons: data.number_of_seasons ?? undefined,
      runtime: data.runtime ?? undefined,
      episode_run_time: data.episode_run_time ?? undefined,
      release_date: data.release_date ?? item.release_date,
      first_air_date: data.first_air_date ?? item.first_air_date,
    };
  } catch {
    return null;
  }
}

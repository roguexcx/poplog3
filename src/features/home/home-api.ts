import type { TMDBItem, TMDBDetails } from "@/types/tmdb";
import { catalogGetTrending } from "@/server/source-engine/engine";
import { hydrateCatalogResultsWithDebug } from "@/server/source-engine/hydrate-catalog-results";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";

export type { TMDBDetails };

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
  } catch {
    return [];
  }
}

export async function getPopularMovies(): Promise<TMDBItem[]> {
  return [];
}

export async function getPopularTV(): Promise<TMDBItem[]> {
  return [];
}

export async function getFeaturedDetails(
  _mediaType: "movie" | "tv",
  _id: number,
): Promise<TMDBDetails | null> {
  return null;
}

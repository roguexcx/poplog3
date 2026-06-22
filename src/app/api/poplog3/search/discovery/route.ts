import { NextResponse } from "next/server";
import {
  catalogGetTrending,
  catalogGetPopular,
  isBalloonerismTrendingEnabled,
  isBalloonerismDiscoverEnabled,
} from "@/server/source-engine/engine";
import { hydrateCatalogResultsWithDebug } from "@/server/source-engine/hydrate-catalog-results";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { isTraktIndexEnabled } from "@/lib/trakt-index/engine";
import { getPoplogDailyTrendingIndex } from "@/lib/trakt-index/canonical";
import type { TraktIndexItem } from "@/lib/trakt-index/types";

const STATIC_GENRES = [
  { id: 28,  name: "Ação" },
  { id: 12,  name: "Aventura" },
  { id: 16,  name: "Animação" },
  { id: 35,  name: "Comédia" },
  { id: 80,  name: "Crime" },
  { id: 99,  name: "Documentário" },
  { id: 18,  name: "Drama" },
  { id: 10751, name: "Família" },
  { id: 14,  name: "Fantasia" },
  { id: 27,  name: "Terror" },
  { id: 9648, name: "Mistério" },
  { id: 10749, name: "Romance" },
  { id: 878, name: "Ficção Científica" },
  { id: 53,  name: "Suspense" },
];

function traktItemsToDiscovery(items: TraktIndexItem[]) {
  return items.map((item) => ({
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: item.title,
    original_title: item.original_title,
    overview: item.overview,
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path,
    release_date: item.release_date,
    first_air_date: item.first_air_date,
    vote_average: item.vote_average,
    popularity: item.popularity,
    poplogId: null,
    externalIds: item.externalIds,
    identityUsed: item.identityUsed,
    linkIdUsed: item.linkIdUsed,
    hasPoplogId: false,
    normalizedFrom: item.normalizedFrom,
    legacyCompatibilityUsed: true,
  }));
}

export async function GET() {
  try {
    // ── Trakt Index como fonte primária de trending ──────────────────────────
    let trendingRaw: ReturnType<typeof traktItemsToDiscovery> = [];
    let popularMovies: ReturnType<typeof traktItemsToDiscovery> = [];
    let popularSeries: ReturnType<typeof traktItemsToDiscovery> = [];

    if (isTraktIndexEnabled()) {
      try {
        const traktItems: TraktIndexItem[] = await getPoplogDailyTrendingIndex();

        if (traktItems.length >= 3) {
          const converted = traktItemsToDiscovery(traktItems);
          trendingRaw = converted.slice(0, 20);
          popularMovies = converted.filter((i) => i.media_type === "movie").slice(0, 12);
          popularSeries = converted.filter((i) => i.media_type === "tv").slice(0, 12);

          return NextResponse.json({
            ok: true,
            trending: trendingRaw,
            popularMovies,
            popularSeries,
            genres: STATIC_GENRES,
          });
        }
      } catch (err) {
        console.warn("[search/discovery] trakt_index failed", err instanceof Error ? err.message : err);
      }
    }

    // ── Balloonerismm fallback ────────────────────────────────────────────────
    const [movieTrending, tvTrending, moviePopular, tvPopular] = await Promise.allSettled([
      isBalloonerismTrendingEnabled()
        ? catalogGetTrending({ mediaType: "movie", limit: 12 })
        : Promise.resolve([]),
      isBalloonerismTrendingEnabled()
        ? catalogGetTrending({ mediaType: "show", limit: 12 })
        : Promise.resolve([]),
      isBalloonerismDiscoverEnabled()
        ? catalogGetPopular({ mediaType: "movie", limit: 12 })
        : Promise.resolve([]),
      isBalloonerismDiscoverEnabled()
        ? catalogGetPopular({ mediaType: "show", limit: 12 })
        : Promise.resolve([]),
    ]);

    const safeMovieTrending = movieTrending.status === "fulfilled" ? movieTrending.value : [];
    const safeTvTrending    = tvTrending.status    === "fulfilled" ? tvTrending.value    : [];
    const safeMoviePopular  = moviePopular.status  === "fulfilled" ? moviePopular.value  : [];
    const safeTvPopular     = tvPopular.status     === "fulfilled" ? tvPopular.value     : [];

    const [mTrendHydrated, tvTrendHydrated, mPopHydrated, tvPopHydrated] = await Promise.all([
      hydrateCatalogResultsWithDebug(safeMovieTrending),
      hydrateCatalogResultsWithDebug(safeTvTrending),
      hydrateCatalogResultsWithDebug(safeMoviePopular),
      hydrateCatalogResultsWithDebug(safeTvPopular),
    ]);

    trendingRaw = [
      ...filterValidTitles(mTrendHydrated.titles),
      ...filterValidTitles(tvTrendHydrated.titles),
    ].slice(0, 20) as ReturnType<typeof traktItemsToDiscovery>;

    popularMovies = filterValidTitles(mPopHydrated.titles).slice(0, 12) as ReturnType<typeof traktItemsToDiscovery>;
    popularSeries = filterValidTitles(tvPopHydrated.titles).slice(0, 12) as ReturnType<typeof traktItemsToDiscovery>;

    return NextResponse.json({
      ok: true,
      trending: trendingRaw,
      popularMovies,
      popularSeries,
      genres: STATIC_GENRES,
    });
  } catch (error) {
    console.error("[search/discovery]", error);
    return NextResponse.json({
      ok: false,
      trending: [],
      popularMovies: [],
      popularSeries: [],
      genres: STATIC_GENRES,
    });
  }
}

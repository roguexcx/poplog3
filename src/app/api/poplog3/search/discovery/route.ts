import { NextResponse } from "next/server";
import {
  catalogGetTrending,
  catalogGetPopular,
  isBalloonerismTrendingEnabled,
  isBalloonerismDiscoverEnabled,
} from "@/server/source-engine/engine";
import { hydrateCatalogResultsWithDebug } from "@/server/source-engine/hydrate-catalog-results";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";

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

export async function GET() {
  try {
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

    const trendingRaw = [
      ...filterValidTitles(mTrendHydrated.titles),
      ...filterValidTitles(tvTrendHydrated.titles),
    ].slice(0, 20);

    const popularMovies = filterValidTitles(mPopHydrated.titles).slice(0, 12);
    const popularSeries = filterValidTitles(tvPopHydrated.titles).slice(0, 12);

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

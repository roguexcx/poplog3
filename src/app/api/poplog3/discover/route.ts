import { NextRequest, NextResponse } from "next/server";

import { catalogGetByGenre, catalogGetPopular } from "@/server/source-engine/engine";
import { hydrateCatalogResults } from "@/server/source-engine/hydrate-catalog-results";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";

type DiscoverMediaType = "all" | "movie" | "tv";
const DISCOVER_MIN_RESULTS = 5;

function parseMediaType(value: string | null): DiscoverMediaType {
  if (value === "movie" || value === "tv") return value;
  return "all";
}

function parsePage(value: string | null): number {
  const page = Number(value);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

function parseGenre(value: string | null): number | undefined {
  if (!value) return undefined;
  const genre = Number(value);
  if (!Number.isFinite(genre) || genre <= 0) return undefined;
  return Math.floor(genre);
}

async function getTraktSection(mediaType: "movie" | "tv", genre?: number) {
  const catalogMediaType = mediaType === "tv" ? "show" : "movie";
  const raw = genre
    ? await catalogGetByGenre({ mediaType: catalogMediaType, genreId: genre })
    : await catalogGetPopular({ mediaType: catalogMediaType, limit: 24 });
  const hydrated = await hydrateCatalogResults(raw);
  return filterValidTitles(hydrated);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = parseMediaType(searchParams.get("type"));
  const page = parsePage(searchParams.get("page"));
  const genre = parseGenre(searchParams.get("genre"));

  try {
    if (page === 1) {
      if (type === "movie") {
        const movies = await getTraktSection("movie", genre);
        if (movies.length >= DISCOVER_MIN_RESULTS) {
          return NextResponse.json({
            ok: true,
            type,
            genre,
            popularMovies: movies,
            results: movies,
            page: 1,
            totalPages: 1,
            totalResults: movies.length,
            debugSource: { source: "trakt", cacheStrategy: "db_first_write_through" },
          });
        }
      } else if (type === "tv") {
        const series = await getTraktSection("tv", genre);
        if (series.length >= DISCOVER_MIN_RESULTS) {
          return NextResponse.json({
            ok: true,
            type,
            genre,
            popularSeries: series,
            results: series,
            page: 1,
            totalPages: 1,
            totalResults: series.length,
            debugSource: { source: "trakt", cacheStrategy: "db_first_write_through" },
          });
        }
      } else {
        const [movies, series] = await Promise.all([
          getTraktSection("movie", genre),
          getTraktSection("tv", genre),
        ]);

        if (movies.length >= DISCOVER_MIN_RESULTS || series.length >= DISCOVER_MIN_RESULTS) {
          return NextResponse.json({
            ok: true,
            type,
            genre,
            popularMovies: movies,
            popularSeries: series,
            results: [...movies, ...series].slice(0, 24),
            page: 1,
            totalPages: 1,
            totalResults: movies.length + series.length,
            debugSource: { source: "trakt", cacheStrategy: "db_first_write_through" },
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      type,
      genre,
      popular: [],
      topRated: [],
      popularMovies: [],
      popularSeries: [],
      results: [],
      page,
      totalPages: 1,
      totalResults: 0,
      debugSource: {
        source: "local_cache",
        fallbackUsed: true,
        fallbackReason: "trakt_empty_or_unavailable",
      },
    });
  } catch (error) {
    console.error("[poplog3/discover]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load discover data",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

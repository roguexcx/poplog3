import { NextRequest, NextResponse } from "next/server";

import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import {
  catalogGetPopular,
  isBalloonerismDiscoverEnabled,
} from "@/server/source-engine/engine";
import { hydrateCatalogResults } from "@/server/source-engine/hydrate-catalog-results";
import type { PoplogTitle } from "@/server/types/title";

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

// Balloonerismm helpers ───────────────────────────────────────────────────────

async function getBalloonerismSection(
  mediaType: "movie" | "tv",
  genre?: number
): Promise<PoplogTitle[]> {
  const catalogMediaType = mediaType === "tv" ? "show" : "movie";
  const raw = await catalogGetPopular({ mediaType: catalogMediaType });
  const hydrated = await hydrateCatalogResults(raw);
  const valid = filterValidTitles(hydrated);
  // Genre filter applied from local DB data (genres field already hydrated)
  return genre ? valid.filter((t) => (t.genres ?? []).includes(genre)) : valid;
}

function toBalloonerismDiscoverSection(titles: PoplogTitle[]) {
  return {
    page: 1,
    totalPages: 1,
    totalResults: titles.length,
    results: titles,
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const type = parseMediaType(searchParams.get("type"));
  const page = parsePage(searchParams.get("page"));
  const genre = parseGenre(searchParams.get("genre"));

  try {
    // ── Balloonerismm primary path ────────────────────────────────────────────
    // Genre filter + page > 1: fall through to TMDB (no Balloonerismm equivalent)
    if (isBalloonerismDiscoverEnabled() && page === 1) {
      try {
        if (type === "movie") {
          const movies = await getBalloonerismSection("movie", genre);
          if (movies.length >= DISCOVER_MIN_RESULTS) {
            console.log(`[poplog3/discover] source=balloonerismm type=movie count=${movies.length}`);
            return NextResponse.json({
              ok: true,
              type,
              genre,
              popularMovies: movies,
              results: movies,
              page: 1,
              totalPages: 1,
              totalResults: movies.length,
            });
          }
          console.log(`[poplog3/discover] source=balloonerismm_fallback type=movie reason=insufficient count=${movies.length}`);
        } else if (type === "tv") {
          const series = await getBalloonerismSection("tv", genre);
          if (series.length >= DISCOVER_MIN_RESULTS) {
            console.log(`[poplog3/discover] source=balloonerismm type=tv count=${series.length}`);
            return NextResponse.json({
              ok: true,
              type,
              genre,
              popularSeries: series,
              results: series,
              page: 1,
              totalPages: 1,
              totalResults: series.length,
            });
          }
          console.log(`[poplog3/discover] source=balloonerismm_fallback type=tv reason=insufficient count=${series.length}`);
        } else {
          // type === "all": parallel fetch both
          const [movies, series] = await Promise.all([
            getBalloonerismSection("movie", genre),
            getBalloonerismSection("tv", genre),
          ]);

          if (
            movies.length >= DISCOVER_MIN_RESULTS &&
            series.length >= DISCOVER_MIN_RESULTS
          ) {
            const allResults = toBalloonerismDiscoverSection(
              [...movies, ...series].slice(0, 24)
            );

            console.log(
              `[poplog3/discover] source=balloonerismm type=all movies=${movies.length} series=${series.length}`
            );

            return NextResponse.json({
              ok: true,
              type,
              genre,
              popular: allResults.results,
              topRated: allResults.results,
              popularMovies: movies,
              popularSeries: series,
              results: allResults.results,
              page: 1,
              totalPages: 1,
              totalResults: movies.length + series.length,
            });
          }

          console.log(
            `[poplog3/discover] source=balloonerismm_fallback type=all reason=insufficient movies=${movies.length} series=${series.length}`
          );
        }
      } catch (err) {
        console.warn(
          `[poplog3/discover] source=balloonerismm_fallback reason=error type=${type}`,
          err instanceof Error ? err.message : err
        );
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
        source: "unavailable",
        fallbackUsed: true,
        fallbackReason: "tmdb_fallback_blocked",
        usedTmdbApi: false,
        usedLegacy: false,
        normalizedFrom: "none",
        identityUsed: "none",
        legacyCompatibilityUsed: true,
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
      { status: 500 }
    );
  }
}

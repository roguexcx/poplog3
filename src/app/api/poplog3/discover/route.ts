import { NextRequest, NextResponse } from "next/server";

import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import {
  catalogGetPopular,
  isBalloonerismDiscoverEnabled,
} from "@/server/source-engine/engine";
import { hydrateCatalogResults } from "@/server/source-engine/hydrate-catalog-results";
import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";
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

async function getBalloonerismByGenre(
  mediaType: "movie" | "tv",
  genre: number,
): Promise<PoplogTitle[]> {
  const path = mediaType === "movie" ? "/discover/movie" : "/discover/tv";
  const raw = await balloonerismGet<unknown>(path, {
    params: { with_genres: genre, language: "pt-BR", region: "BR", page: 1 },
    ttlSeconds: 3600,
  });
  if (!raw) return [];

  const items = Array.isArray(raw) ? raw
    : Array.isArray((raw as Record<string, unknown>).results) ? (raw as Record<string, unknown>).results as unknown[]
    : [];

  const { normalizeSearchResult } = await import("@/server/source-engine/normalizers/normalize-search");
  const catalogResults = (items as Array<Record<string, unknown>>).map((item) => {
    const imdbId = typeof item.imdb_id === "string" ? item.imdb_id : undefined;
    return normalizeSearchResult(
      {
        ids: {
          imdbId,
          tmdbId: typeof item.tmdb_id === "number" ? item.tmdb_id : undefined,
          balloonerismmId: imdbId,
        },
        mediaType: mediaType === "tv" ? "show" : "movie",
        title: typeof item.title === "string" ? item.title : typeof item.name === "string" ? item.name : "",
        originalTitle: typeof item.original_title === "string" ? item.original_title : undefined,
        year: typeof item.year === "number" ? item.year : undefined,
        releaseDate: typeof item.release_date === "string" ? item.release_date : undefined,
        firstAirDate: typeof item.first_air_date === "string" ? item.first_air_date : undefined,
        overview: typeof item.overview === "string" ? item.overview : undefined,
        posterRemoteUrl: typeof item.poster_path === "string" ? item.poster_path : undefined,
        backdropRemoteUrl: typeof item.backdrop_path === "string" ? item.backdrop_path : undefined,
        voteAverage: typeof item.vote_average === "number" ? item.vote_average : undefined,
      },
      { primary: "balloonerismm", confidence: "medium", usedFallback: false, fetchedAt: new Date().toISOString() },
    );
  });

  const hydrated = await hydrateCatalogResults(catalogResults);
  return filterValidTitles(hydrated);
}

async function getBalloonerismSection(
  mediaType: "movie" | "tv",
  genre?: number
): Promise<PoplogTitle[]> {
  if (genre) return getBalloonerismByGenre(mediaType, genre);
  const catalogMediaType = mediaType === "tv" ? "show" : "movie";
  const raw = await catalogGetPopular({ mediaType: catalogMediaType });
  const hydrated = await hydrateCatalogResults(raw);
  return filterValidTitles(hydrated);
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

import { NextRequest, NextResponse } from "next/server";

import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import { upsertCachedTitle } from "@/server/cache/title-cache";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";
import {
  catalogGetPopular,
  isBalloonerismDiscoverEnabled,
} from "@/server/source-engine/engine";
import { hydrateCatalogResults } from "@/server/source-engine/hydrate-catalog-results";
import type { PoplogTitle } from "@/server/types/title";

type DiscoverMediaType = "all" | "movie" | "tv";
const DISCOVER_MIN_RESULTS = 5;

type TmdbListResponse = {
  page: number;
  total_pages: number;
  total_results: number;
  results: TmdbTitleSummary[];
};

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

async function cacheTitles(
  titles: ReturnType<typeof normalizeTmdbTitle>[],
  rawResults: TmdbTitleSummary[],
  fallbackMediaType: "movie" | "tv"
) {
  await Promise.all(
    titles.map(async (title) => {
      const rawTitle = rawResults.find((item) => {
        const rawMediaType = item.media_type ?? fallbackMediaType;
        return item.id === title.tmdb_id && rawMediaType === title.media_type;
      });
      if (!rawTitle) return;
      try {
        await upsertCachedTitle(title, {
          ...rawTitle,
          media_type: rawTitle.media_type ?? fallbackMediaType,
        });
      } catch (error) {
        console.warn(
          `[poplog3/discover] falha ao cachear ${title.media_type}/${title.tmdb_id}:`,
          error instanceof Error ? error.message : error
        );
      }
    })
  );
}

async function getDiscoverSection({
  mediaType,
  genre,
  page,
  sortBy,
}: {
  mediaType: "movie" | "tv";
  genre?: number;
  page: number;
  sortBy: string;
}) {
  const data = await tmdbFetch<TmdbListResponse>(`/discover/${mediaType}`, {
    params: {
      page,
      include_adult: false,
      sort_by: sortBy,
      ...(genre ? { with_genres: genre } : {}),
    },
  });

  const normalized = data.results.map((item) =>
    normalizeTmdbTitle({ ...item, media_type: mediaType })
  );
  const titles = filterValidTitles(normalized);
  await cacheTitles(titles, data.results, mediaType);

  return {
    page: data.page ?? page,
    totalPages: data.total_pages ?? 1,
    totalResults: data.total_results ?? titles.length,
    results: titles,
  };
}

function mergeResults(
  a: Awaited<ReturnType<typeof getDiscoverSection>>,
  b: Awaited<ReturnType<typeof getDiscoverSection>>
) {
  const merged = [...a.results, ...b.results];
  return {
    page: 1,
    totalPages: Math.max(a.totalPages, b.totalPages),
    totalResults: a.totalResults + b.totalResults,
    results: merged.slice(0, 24),
  };
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

    // ── Legacy TMDB path (fallback) ──────────────────────────────────────────
    if (type === "movie") {
      const popularMovies = await getDiscoverSection({
        mediaType: "movie",
        genre,
        page,
        sortBy: "popularity.desc",
      });

      return NextResponse.json({
        ok: true,
        type,
        genre,
        popularMovies: popularMovies.results,
        results: popularMovies.results,
        page: popularMovies.page,
        totalPages: popularMovies.totalPages,
        totalResults: popularMovies.totalResults,
      });
    }

    if (type === "tv") {
      const popularSeries = await getDiscoverSection({
        mediaType: "tv",
        genre,
        page,
        sortBy: "popularity.desc",
      });

      return NextResponse.json({
        ok: true,
        type,
        genre,
        popularSeries: popularSeries.results,
        results: popularSeries.results,
        page: popularSeries.page,
        totalPages: popularSeries.totalPages,
        totalResults: popularSeries.totalResults,
      });
    }

    const [popularMovies, popularSeries, topMovies, topSeries] = await Promise.all([
      getDiscoverSection({ mediaType: "movie", genre, page, sortBy: "popularity.desc" }),
      getDiscoverSection({ mediaType: "tv", genre, page, sortBy: "popularity.desc" }),
      getDiscoverSection({ mediaType: "movie", genre, page, sortBy: "vote_average.desc" }),
      getDiscoverSection({ mediaType: "tv", genre, page, sortBy: "vote_average.desc" }),
    ]);

    const popular = mergeResults(popularMovies, popularSeries);
    const topRated = mergeResults(topMovies, topSeries);

    return NextResponse.json({
      ok: true,
      type,
      genre,
      popular: popular.results,
      topRated: topRated.results,
      popularMovies: popularMovies.results,
      popularSeries: popularSeries.results,
      results: popular.results,
      page: popular.page,
      totalPages: popular.totalPages,
      totalResults: popular.totalResults,
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

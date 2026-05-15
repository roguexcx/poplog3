import { NextRequest, NextResponse } from "next/server";

import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import { upsertCachedTitle } from "@/server/cache/title-cache";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";

type DiscoverMediaType = "all" | "movie" | "tv";

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
  const endpoint = `/discover/${mediaType}`;

  const data = await tmdbFetch<TmdbListResponse>(endpoint, {
    params: {
      page,
      include_adult: false,
      sort_by: sortBy,
      ...(genre ? { with_genres: genre } : {}),
    },
  });

  const normalized = data.results.map((item) =>
    normalizeTmdbTitle({
      ...item,
      media_type: mediaType,
    })
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
  movieResults: Awaited<ReturnType<typeof getDiscoverSection>>,
  tvResults: Awaited<ReturnType<typeof getDiscoverSection>>
) {
  const merged = [...movieResults.results, ...tvResults.results];

  return {
    page: 1,
    totalPages: Math.max(movieResults.totalPages, tvResults.totalPages),
    totalResults: movieResults.totalResults + tvResults.totalResults,
    results: merged.slice(0, 24),
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const type = parseMediaType(searchParams.get("type"));
  const page = parsePage(searchParams.get("page"));
  const genre = parseGenre(searchParams.get("genre"));

  try {
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

    const [popularMovies, popularSeries, topMovies, topSeries] =
      await Promise.all([
        getDiscoverSection({
          mediaType: "movie",
          genre,
          page,
          sortBy: "popularity.desc",
        }),
        getDiscoverSection({
          mediaType: "tv",
          genre,
          page,
          sortBy: "popularity.desc",
        }),
        getDiscoverSection({
          mediaType: "movie",
          genre,
          page,
          sortBy: "vote_average.desc",
        }),
        getDiscoverSection({
          mediaType: "tv",
          genre,
          page,
          sortBy: "vote_average.desc",
        }),
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
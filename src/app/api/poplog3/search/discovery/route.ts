import { NextResponse } from "next/server";

import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import { upsertCachedTitle } from "@/server/cache/title-cache";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";

type TmdbListResponse = {
  page: number;
  total_pages: number;
  total_results: number;
  results: TmdbTitleSummary[];
};

type TmdbGenre = {
  id: number;
  name: string;
};

type TmdbGenresResponse = {
  genres: TmdbGenre[];
};

async function getTitleSection(
  endpoint: string,
  mediaType: "movie" | "tv"
) {
  const data = await tmdbFetch<TmdbListResponse>(endpoint, {
    params: {
      page: 1,
      include_adult: false,
    },
  });

  const normalized = data.results.map((item) =>
    normalizeTmdbTitle({
      ...item,
      media_type: item.media_type ?? mediaType,
    })
  );

  const titles = filterValidTitles(normalized).slice(0, 20);

  await Promise.all(
    titles.map(async (title) => {
      const rawTitle = data.results.find((item) => item.id === title.tmdb_id);

      if (!rawTitle) return;

      try {
        await upsertCachedTitle(title, {
          ...rawTitle,
          media_type: rawTitle.media_type ?? mediaType,
        });
      } catch (error) {
        console.warn(
          `[poplog3/search/discovery] falha ao cachear ${title.media_type}/${title.tmdb_id}:`,
          error instanceof Error ? error.message : error
        );
      }
    })
  );

  return titles;
}

async function getTrendingSection() {
  const data = await tmdbFetch<TmdbListResponse>("/trending/all/day", {
    params: {
      page: 1,
      include_adult: false,
    },
  });

  const onlyTitles = data.results.filter(
    (item) => item.media_type === "movie" || item.media_type === "tv"
  );

  const normalized = onlyTitles.map((item) => normalizeTmdbTitle(item));
  const titles = filterValidTitles(normalized).slice(0, 20);

  await Promise.all(
    titles.map(async (title) => {
      const rawTitle = onlyTitles.find(
        (item) =>
          item.id === title.tmdb_id && item.media_type === title.media_type
      );

      if (!rawTitle) return;

      try {
        await upsertCachedTitle(title, rawTitle);
      } catch (error) {
        console.warn(
          `[poplog3/search/discovery] falha ao cachear trending ${title.media_type}/${title.tmdb_id}:`,
          error instanceof Error ? error.message : error
        );
      }
    })
  );

  return titles;
}

async function getGenres() {
  const [movieGenres, tvGenres] = await Promise.all([
    tmdbFetch<TmdbGenresResponse>("/genre/movie/list"),
    tmdbFetch<TmdbGenresResponse>("/genre/tv/list"),
  ]);

  const merged = new Map<number, TmdbGenre>();

  for (const genre of movieGenres.genres ?? []) {
    merged.set(genre.id, genre);
  }

  for (const genre of tvGenres.genres ?? []) {
    merged.set(genre.id, genre);
  }

  return Array.from(merged.values()).slice(0, 18);
}


export async function GET() {
  try {
    const [trending, popularMovies, popularSeries, genres] =
      await Promise.all([
        getTrendingSection(),
        getTitleSection("/movie/popular", "movie"),
        getTitleSection("/tv/popular", "tv"),
        getGenres(),
      ]);

    return NextResponse.json({
      ok: true,
      trending,
      popularMovies,
      popularSeries,
      genres,
    });
  } catch (error) {
    console.error("[poplog3/search/discovery]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load search discovery data",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

import { findShortcut } from "@/lib/discovery/shortcuts-config";
import {
  catalogGetPopular,
  isBalloonerismDiscoverEnabled,
} from "@/server/source-engine/engine";
import { hydrateCatalogResults } from "@/server/source-engine/hydrate-catalog-results";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { db } from "@/server/db/client";
import type { PoplogTitle } from "@/server/types/title";

// ── Genre ID map ──────────────────────────────────────────────────────────────

const SLUG_TO_GENRE: Record<string, number> = {
  "acao-aventura":     28,
  "comedia":           35,
  "drama":             18,
  "terror":            27,
  "romance":           10749,
  "ficcao-cientifica": 878,
  "fantasia":          14,
  "documentario":      99,
  "animacao":          16,
};

// Slugs that fetch only one media type (undefined = both)
const SLUG_MEDIA: Record<string, "movie" | "tv"> = {
  "romance": "movie",
};

// Popular-only slugs (no genre)
const SLUG_POPULAR_SCOPE: Record<string, "movie" | "tv" | "all"> = {
  "bombando-agora":    "all",
  "filmes-em-alta":    "movie",
  "series-em-alta":    "tv",
  "classicos-populares": "all",
};

// ── DB genre fetch (local catalog) ───────────────────────────────────────────

type RawTitleRow = {
  id: string;
  tmdb_id: number;
  media_type: string;
  title: string | null;
  original_title: string | null;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: Date | null;
  first_air_date: Date | null;
  year: number | null;
  runtime: number | null;
  vote_average: string | null;
  vote_count: number | null;
  popularity: string | null;
  original_language: string | null;
};

async function fetchByGenreFromDB(
  mediaType: "movie" | "tv",
  genre: number,
  limit = 20,
): Promise<PoplogTitle[]> {
  const rows = await db.$queryRaw<RawTitleRow[]>`
    SELECT
      id,
      tmdb_id,
      media_type,
      title,
      original_title,
      overview,
      poster_path,
      backdrop_path,
      release_date,
      first_air_date,
      year,
      runtime,
      vote_average,
      vote_count,
      popularity,
      original_language
    FROM poplog_v3.poplog3_titles
    WHERE media_type = ${mediaType}
      AND poster_path IS NOT NULL
      AND JSON_CONTAINS(genres, CAST(${genre} AS JSON))
    ORDER BY CAST(popularity AS DECIMAL(10,3)) DESC
    LIMIT ${limit}
  `;

  return rows.map((row): PoplogTitle => ({
    tmdb_id: row.tmdb_id,
    media_type: row.media_type as "movie" | "tv",
    poplogId: row.id,
    identityUsed: "poplog_id",
    linkIdUsed: row.id,
    hasPoplogId: true,
    normalizedFrom: "legacy",
    legacyCompatibilityUsed: false,
    title: row.title ?? "",
    original_title: row.original_title ?? null,
    overview: row.overview ?? null,
    poster_path: row.poster_path ?? null,
    backdrop_path: row.backdrop_path ?? null,
    release_date: mediaType === "movie" ? (row.release_date?.toISOString().slice(0, 10) ?? null) : null,
    first_air_date: mediaType === "tv" ? (row.first_air_date?.toISOString().slice(0, 10) ?? null) : null,
    last_air_date: null,
    year: row.year ?? null,
    runtime: mediaType === "movie" ? row.runtime : null,
    episode_run_time: null,
    genres: [],
    popularity: row.popularity != null ? Number(row.popularity) : null,
    vote_average: row.vote_average != null ? Number(row.vote_average) : null,
    vote_count: row.vote_count ?? null,
    original_language: row.original_language ?? null,
  }));
}

// ── Popular fetch ─────────────────────────────────────────────────────────────

async function fetchPopular(
  scope: "movie" | "tv" | "all",
): Promise<{ movies: PoplogTitle[]; series: PoplogTitle[] }> {
  if (!isBalloonerismDiscoverEnabled()) return { movies: [], series: [] };

  if (scope === "movie") {
    const raw = await catalogGetPopular({ mediaType: "movie", limit: 20 });
    return { movies: filterValidTitles(await hydrateCatalogResults(raw)), series: [] };
  }
  if (scope === "tv") {
    const raw = await catalogGetPopular({ mediaType: "show", limit: 20 });
    return { movies: [], series: filterValidTitles(await hydrateCatalogResults(raw)) };
  }
  const [m, tv] = await Promise.all([
    catalogGetPopular({ mediaType: "movie", limit: 20 }),
    catalogGetPopular({ mediaType: "show", limit: 20 }),
  ]);
  return {
    movies: filterValidTitles(await hydrateCatalogResults(m)),
    series: filterValidTitles(await hydrateCatalogResults(tv)),
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const shortcut = findShortcut(slug);

  if (!shortcut) {
    return NextResponse.json({ ok: false, error: "Shortcut not found" }, { status: 404 });
  }

  try {
    let movies: PoplogTitle[] = [];
    let series: PoplogTitle[] = [];

    const genreId = SLUG_TO_GENRE[slug];
    const popularScope = SLUG_POPULAR_SCOPE[slug];

    if (genreId) {
      const mediaOverride = SLUG_MEDIA[slug];
      if (mediaOverride === "movie") {
        movies = await fetchByGenreFromDB("movie", genreId);
      } else if (mediaOverride === "tv") {
        series = await fetchByGenreFromDB("tv", genreId);
      } else {
        [movies, series] = await Promise.all([
          fetchByGenreFromDB("movie", genreId),
          fetchByGenreFromDB("tv", genreId),
        ]);
      }
    } else if (popularScope) {
      ({ movies, series } = await fetchPopular(popularScope));
    }

    console.log(`[discovery/shortcut] slug=${slug} source=${genreId ? "db_genre" : "popular"} genre=${genreId ?? "none"} movies=${movies.length} series=${series.length}`);

    return NextResponse.json({
      ok: true,
      slug,
      title: shortcut.editorialTitle,
      description: shortcut.description,
      popularMovies: movies,
      popularSeries: series,
      results: [...movies, ...series].slice(0, 40),
    });
  } catch (error) {
    console.error(`[discovery/shortcut] slug=${slug}`, error);
    return NextResponse.json(
      { ok: false, error: "Failed to load shortcut results", slug },
      { status: 500 },
    );
  }
}

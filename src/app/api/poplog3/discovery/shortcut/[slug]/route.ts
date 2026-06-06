import { NextRequest, NextResponse } from "next/server";

import {
  findFilter,
  findTrending,
} from "@/lib/discovery/shortcuts-config";
import { filterTraktItems, normSlug } from "@/lib/discovery/genre-filter";
import {
  getPoplogDailyTrendingIndex,
} from "@/lib/trakt-index/canonical";
import { isTraktIndexEnabled } from "@/lib/trakt-index/engine";
import {
  catalogGetPopular,
  isBalloonerismDiscoverEnabled,
} from "@/server/source-engine/engine";
import { hydrateCatalogResults } from "@/server/source-engine/hydrate-catalog-results";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { db } from "@/server/db/client";
import type { PoplogTitle } from "@/server/types/title";
import type { TraktIndexItem } from "@/lib/trakt-index/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_RESULTS = 8;
const MAX_PER_TYPE = 24;

// ─── TMDB genre IDs for local-DB fallback (primary genres only) ───────────────

const FILTER_TO_TMDB_GENRE: Record<string, number> = {
  "acao-aventura":                    28,
  "horror-thriller":                  27,
  "familia-animacao-anime":           16,
  "documentario-biografia-historia":  99,
  "musica-musical":                   10402,
  "drama-prestigio":                  18,
  "romance":                          10749,
  "comedia":                          35,
  "crime":                            80,
  "fantasia":                         14,
  "misterio":                         9648,
  // moods — map to closest primary genre
  "adrenalina":                       28,
  "assustador":                       27,
  "leve":                             35,
  "investigacao":                     80,
  "sci-fi-futurista":                 878,
  "plot-twist":                       9648,
};

// ─── Local DB genre fetch ─────────────────────────────────────────────────────

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
  limit = 24,
): Promise<PoplogTitle[]> {
  const rows = await db.$queryRaw<RawTitleRow[]>`
    SELECT
      id, tmdb_id, media_type, title, original_title, overview,
      poster_path, backdrop_path, release_date, first_air_date,
      year, runtime, vote_average, vote_count, popularity, original_language
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

// ─── Convert TraktIndexItem to the SearchResult-compatible shape ──────────────

function traktItemToResult(item: TraktIndexItem) {
  return {
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
    poplogId: null as null,
    externalIds: item.externalIds,
    identityUsed: item.identityUsed,
    linkIdUsed: item.linkIdUsed,
    hasPoplogId: false as const,
    normalizedFrom: item.normalizedFrom,
    legacyCompatibilityUsed: true as const,
  };
}

// ─── Trending handler ─────────────────────────────────────────────────────────

async function handleTrending(
  scope: "all" | "movie" | "tv",
  slug: string,
  label: string,
  description: string,
) {
  let movies: PoplogTitle[] = [];
  let series: PoplogTitle[] = [];

  if (isTraktIndexEnabled()) {
    try {
      const items = await getPoplogDailyTrendingIndex();
      if (items.length >= 3) {
        const forMovies = scope === "all" || scope === "movie"
          ? items.filter((i) => i.media_type === "movie").slice(0, MAX_PER_TYPE).map(traktItemToResult)
          : [];
        const forSeries = scope === "all" || scope === "tv"
          ? items.filter((i) => i.media_type === "tv").slice(0, MAX_PER_TYPE).map(traktItemToResult)
          : [];
        return NextResponse.json({
          ok: true, slug, title: label, displayTitle: label, description,
          popularMovies: forMovies, popularSeries: forSeries,
          results: [...forMovies, ...forSeries].slice(0, 40),
          fallbackUsed: false, source: "trakt_index",
          debug: { slugs: [], beforeFilter: items.length, afterFilter: forMovies.length + forSeries.length, fallbackItems: 0 },
        });
      }
    } catch (err) {
      console.warn("[discovery/shortcut] trakt_index failed for trending", err instanceof Error ? err.message : err);
    }
  }

  if (!isBalloonerismDiscoverEnabled()) {
    return NextResponse.json({ ok: true, slug, title: label, displayTitle: label, description, popularMovies: [], popularSeries: [], results: [], fallbackUsed: false, source: "none", debug: { slugs: [], beforeFilter: 0, afterFilter: 0, fallbackItems: 0 } });
  }

  if (scope === "movie" || scope === "all") {
    const raw = await catalogGetPopular({ mediaType: "movie", limit: 20 });
    movies = filterValidTitles(await hydrateCatalogResults(raw));
  }
  if (scope === "tv" || scope === "all") {
    const raw = await catalogGetPopular({ mediaType: "show", limit: 20 });
    series = filterValidTitles(await hydrateCatalogResults(raw));
  }

  return NextResponse.json({
    ok: true, slug, title: label, displayTitle: label, description,
    popularMovies: movies, popularSeries: series,
    results: [...movies, ...series].slice(0, 40),
    fallbackUsed: false, source: "balloonerismm",
    debug: { slugs: [], beforeFilter: 0, afterFilter: movies.length + series.length, fallbackItems: 0 },
  });
}

// ─── Genre/mood handler ───────────────────────────────────────────────────────

async function handleGenreFilter(
  slug: string,
  mediaTypeParam: "movie" | "tv" | "all",
) {
  const filter = findFilter(slug)!;
  const slugsUsed = filter.slugs.map(normSlug);
  const tmdbGenreId = FILTER_TO_TMDB_GENRE[slug];

  // 1. Load Trakt Index
  let traktItems: TraktIndexItem[] = [];
  let source: string = "none";

  if (isTraktIndexEnabled()) {
    try {
      traktItems = await getPoplogDailyTrendingIndex();
      source = "trakt_index";
    } catch (err) {
      console.warn("[discovery/shortcut] trakt_index failed", err instanceof Error ? err.message : err);
    }
  }

  const beforeFilter = traktItems.length;

  // 2. Filter by genre + media type
  const filtered = filterTraktItems(traktItems, filter, mediaTypeParam);

  // 3. Split into movies / series
  let movieItems = filtered
    .filter((i) => i.media_type === "movie")
    .slice(0, MAX_PER_TYPE)
    .map(traktItemToResult);
  let seriesItems = filtered
    .filter((i) => i.media_type === "tv")
    .slice(0, MAX_PER_TYPE)
    .map(traktItemToResult);

  const afterFilter = movieItems.length + seriesItems.length;

  // 4. Fallback: local DB when thin and popularFallback enabled
  let fallbackUsed = false;
  let fallbackItems = 0;

  if (filter.popularFallback && tmdbGenreId) {
    const needMovies = (mediaTypeParam === "all" || mediaTypeParam === "movie") && movieItems.length < MIN_RESULTS;
    const needSeries = (mediaTypeParam === "all" || mediaTypeParam === "tv") && seriesItems.length < MIN_RESULTS;

    if (needMovies || needSeries) {
      const seenMovieIds = new Set(movieItems.map((m) => m.tmdb_id));
      const seenSeriesIds = new Set(seriesItems.map((s) => s.tmdb_id));

      const [fbMovies, fbSeries] = await Promise.all([
        needMovies ? fetchByGenreFromDB("movie", tmdbGenreId, 24) : Promise.resolve([]),
        needSeries ? fetchByGenreFromDB("tv", tmdbGenreId, 24) : Promise.resolve([]),
      ]);

      const newMovies = fbMovies.filter((m) => !seenMovieIds.has(m.tmdb_id));
      const newSeries = fbSeries.filter((s) => !seenSeriesIds.has(s.tmdb_id));

      if (newMovies.length + newSeries.length > 0) {
        fallbackUsed = true;
        fallbackItems = newMovies.length + newSeries.length;
        if (needMovies) movieItems = [...movieItems, ...newMovies as typeof movieItems].slice(0, MAX_PER_TYPE);
        if (needSeries) seriesItems = [...seriesItems, ...newSeries as typeof seriesItems].slice(0, MAX_PER_TYPE);
        if (source === "none") source = "local_db_fallback";
        else source = "trakt_index+local_db_fallback";
      }
    }
  }

  // 5. Label: swap to "Populares no gênero: X" when fallback fired and result was thin
  const totalResults = movieItems.length + seriesItems.length;
  const useFallbackLabel = filter.fallbackPopularLabel && (fallbackUsed || totalResults < MIN_RESULTS);
  const displayTitle = useFallbackLabel
    ? `Populares no gênero: ${filter.label}`
    : filter.label;

  console.log(
    "[discovery/shortcut] slug=%s type=%s source=%s before=%d after=%d fallback=%s fallbackItems=%d",
    slug, mediaTypeParam, source, beforeFilter, afterFilter, fallbackUsed, fallbackItems,
  );

  return NextResponse.json({
    ok: true,
    slug,
    title: filter.label,
    displayTitle,
    description: filter.desc ?? "",
    popularMovies: mediaTypeParam === "tv" ? [] : movieItems,
    popularSeries: mediaTypeParam === "movie" ? [] : seriesItems,
    results: [...movieItems, ...seriesItems].slice(0, 40),
    fallbackUsed,
    source,
    debug: {
      slugs: slugsUsed,
      beforeFilter,
      afterFilter,
      fallbackItems,
      mediaTypeFilter: mediaTypeParam,
    },
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const url = request.nextUrl;
  const rawType = url.searchParams.get("type") ?? "all";
  const mediaType: "movie" | "tv" | "all" =
    rawType === "movie" || rawType === "tv" ? rawType : "all";

  // Trending shortcuts
  const trending = findTrending(slug);
  if (trending) {
    try {
      return await handleTrending(trending.scope, slug, trending.label, trending.description);
    } catch (error) {
      console.error(`[discovery/shortcut] trending slug=${slug}`, error);
      return NextResponse.json({ ok: false, error: "Failed to load", slug }, { status: 500 });
    }
  }

  // Genre / mood filters
  const filter = findFilter(slug);
  if (!filter) {
    // Legacy slug support: old shortcuts that were removed — return 404
    console.warn("[discovery/shortcut] unknown slug=%s", slug);
    return NextResponse.json({ ok: false, error: "Filter not found", slug }, { status: 404 });
  }

  try {
    return await handleGenreFilter(slug, mediaType);
  } catch (error) {
    console.error(`[discovery/shortcut] genre slug=${slug}`, error);
    return NextResponse.json({ ok: false, error: "Failed to load", slug }, { status: 500 });
  }
}


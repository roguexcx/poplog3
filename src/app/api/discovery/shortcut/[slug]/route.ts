import { NextRequest, NextResponse } from "next/server";

import {
  findFilter,
  findTrending,
} from "@/lib/discovery/shortcuts-config";
import { filterTraktItems, normSlug } from "@/lib/discovery/genre-filter";
import { resolveDisplayTitle } from "@/lib/titles/display-title";
import {
  getPoplogDailyTrendingIndex,
} from "@/lib/trakt-index/canonical";
import { isTraktIndexEnabled } from "@/lib/trakt-index/engine";
import {
  catalogGetPopular,
  isBalloonerismDiscoverEnabled,
} from "@/server/source-engine/engine";
import { hydrateCatalogResults } from "@/server/source-engine/hydrate-catalog-results";
import { resolveLocaleScope } from "@/server/source-engine/locale";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { db } from "@/server/db/client";
import type { PoplogTitle } from "@/server/types/title";
import type { TraktIndexItem } from "@/lib/trakt-index/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_RESULTS = 8;
const MAX_PER_TYPE = 24;

const TRENDING_COPY: Record<string, { label: string; description: string }> = {
  "bombando-agora": {
    label: "Trending now",
    description: "The most popular movies and shows right now.",
  },
  "filmes-em-alta": {
    label: "Trending movies",
    description: "The most watched and talked-about movies this week.",
  },
  "series-em-alta": {
    label: "Trending shows",
    description: "The shows getting the most attention right now.",
  },
};

const FILTER_COPY: Record<string, { label: string; desc: string }> = {
  "acao-aventura": { label: "Action & Adventure", desc: "action, adventure, superheroes and westerns" },
  "horror-thriller": { label: "Horror & Thriller", desc: "horror, thriller and suspense" },
  "familia-animacao-anime": { label: "Family, Animation & Anime", desc: "family, kids, animation, anime and donghua" },
  "documentario-biografia-historia": { label: "Documentary, Biography & History", desc: "documentaries, biographies and true stories" },
  "musica-musical": { label: "Music & Musical", desc: "music and musicals together" },
  "drama-prestigio": { label: "Drama / Prestige", desc: "drama, history, biography, war and soap" },
  romance: { label: "Romance", desc: "romance and love stories" },
  comedia: { label: "Comedy", desc: "popular comedies" },
  crime: { label: "Crime", desc: "crime movies and shows" },
  fantasia: { label: "Fantasy", desc: "magical worlds and epic fantasy" },
  misterio: { label: "Mystery", desc: "mystery and psychological suspense" },
  adrenalina: { label: "Adrenaline", desc: "fast-paced action, adventure and suspense" },
  assustador: { label: "Scary", desc: "horror, thriller and suspense" },
  leve: { label: "Light", desc: "comedy, romance and family, without the weight" },
  investigacao: { label: "Investigation", desc: "crime, mystery and true crime" },
  "sci-fi-futurista": { label: "Sci-fi / Futuristic", desc: "science fiction and speculative fantasy" },
  "plot-twist": { label: "Plot Twist", desc: "mystery, thriller and twists" },
};

function localizeTrending(slug: string, label: string, description: string, language: string) {
  const copy = language === "en-US" ? TRENDING_COPY[slug] : null;
  return {
    label: copy?.label ?? label,
    description: copy?.description ?? description,
  };
}

function localizeFilterCopy(filter: NonNullable<ReturnType<typeof findFilter>>, language: string) {
  const copy = language === "en-US" ? FILTER_COPY[filter.id] : null;
  return {
    label: copy?.label ?? filter.label,
    desc: copy?.desc ?? filter.desc ?? "",
  };
}

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
  language: string,
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
  const useOriginalTitle = language === "en-US";
  return rows.map((row): PoplogTitle => ({
    tmdb_id: row.tmdb_id,
    media_type: row.media_type as "movie" | "tv",
    poplogId: row.id,
    identityUsed: "poplog_id",
    linkIdUsed: row.id,
    hasPoplogId: true,
    normalizedFrom: "legacy",
    legacyCompatibilityUsed: false,
    title: useOriginalTitle
      ? row.original_title ?? row.title ?? ""
      : resolveDisplayTitle({
          title: row.title,
          originalTitle: row.original_title,
          tmdbId: row.tmdb_id,
          poplogId: row.id,
          mediaType: row.media_type as "movie" | "tv",
        }),
    original_title: useOriginalTitle ? null : row.original_title ?? null,
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

function traktItemToResult(item: TraktIndexItem, language: string) {
  const useOriginalTitle = language === "en-US";
  return {
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    title: useOriginalTitle ? item.original_title ?? item.title : item.title,
    original_title: useOriginalTitle ? null : item.original_title,
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
  locale: { language: string; region: string },
) {
  let movies: PoplogTitle[] = [];
  let series: PoplogTitle[] = [];
  const copy = localizeTrending(slug, label, description, locale.language);

  if (isTraktIndexEnabled()) {
    try {
      const items = await getPoplogDailyTrendingIndex();
      if (items.length >= 3) {
          const forMovies = scope === "all" || scope === "movie"
          ? items.filter((i) => i.media_type === "movie").slice(0, MAX_PER_TYPE).map((item) => traktItemToResult(item, locale.language))
          : [];
        const forSeries = scope === "all" || scope === "tv"
          ? items.filter((i) => i.media_type === "tv").slice(0, MAX_PER_TYPE).map((item) => traktItemToResult(item, locale.language))
          : [];
        return NextResponse.json({
          ok: true, slug, title: copy.label, displayTitle: copy.label, description: copy.description,
          popularMovies: forMovies, popularSeries: forSeries,
          results: [...forMovies, ...forSeries].slice(0, 40),
          fallbackUsed: false, source: "trakt_index",
          debug: { slugs: [], beforeFilter: items.length, afterFilter: forMovies.length + forSeries.length, fallbackItems: 0, ...locale },
        });
      }
    } catch (err) {
      console.warn("[discovery/shortcut] trakt_index failed for trending", err instanceof Error ? err.message : err);
    }
  }

  if (!isBalloonerismDiscoverEnabled()) {
    return NextResponse.json({ ok: true, slug, title: copy.label, displayTitle: copy.label, description: copy.description, popularMovies: [], popularSeries: [], results: [], fallbackUsed: false, source: "none", debug: { slugs: [], beforeFilter: 0, afterFilter: 0, fallbackItems: 0, ...locale } });
  }

  if (scope === "movie" || scope === "all") {
    const raw = await catalogGetPopular({ mediaType: "movie", limit: 20, language: locale.language, region: locale.region });
    movies = filterValidTitles(await hydrateCatalogResults(raw));
  }
  if (scope === "tv" || scope === "all") {
    const raw = await catalogGetPopular({ mediaType: "show", limit: 20, language: locale.language, region: locale.region });
    series = filterValidTitles(await hydrateCatalogResults(raw));
  }

  return NextResponse.json({
    ok: true, slug, title: copy.label, displayTitle: copy.label, description: copy.description,
    popularMovies: movies, popularSeries: series,
    results: [...movies, ...series].slice(0, 40),
    fallbackUsed: false, source: "balloonerismm",
    debug: { slugs: [], beforeFilter: 0, afterFilter: movies.length + series.length, fallbackItems: 0, ...locale },
  });
}

// ─── Genre/mood handler ───────────────────────────────────────────────────────

async function handleGenreFilter(
  slug: string,
  mediaTypeParam: "movie" | "tv" | "all",
  locale: { language: string; region: string },
) {
  const filter = findFilter(slug)!;
  const copy = localizeFilterCopy(filter, locale.language);
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
    .map((item) => traktItemToResult(item, locale.language));
  let seriesItems = filtered
    .filter((i) => i.media_type === "tv")
    .slice(0, MAX_PER_TYPE)
    .map((item) => traktItemToResult(item, locale.language));

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
        needMovies ? fetchByGenreFromDB("movie", tmdbGenreId, locale.language, 24) : Promise.resolve([]),
        needSeries ? fetchByGenreFromDB("tv", tmdbGenreId, locale.language, 24) : Promise.resolve([]),
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
    ? locale.language === "en-US"
      ? `Popular in genre: ${copy.label}`
      : `Populares no gênero: ${filter.label}`
    : copy.label;

  console.log(
    "[discovery/shortcut] slug=%s type=%s source=%s before=%d after=%d fallback=%s fallbackItems=%d",
    slug, mediaTypeParam, source, beforeFilter, afterFilter, fallbackUsed, fallbackItems,
  );

  return NextResponse.json({
    ok: true,
    slug,
    title: copy.label,
    displayTitle,
    description: copy.desc,
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
      ...locale,
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
  const localeScope = resolveLocaleScope({
    language:
      url.searchParams.get("language") ??
      url.searchParams.get("locale") ??
      request.cookies.get("poplog_catalog_language")?.value,
    region:
      url.searchParams.get("region") ??
      request.cookies.get("poplog_region")?.value,
  });
  const locale = { language: localeScope.catalogLanguage, region: localeScope.region };

  // Trending shortcuts
  const trending = findTrending(slug);
  if (trending) {
    try {
      return await handleTrending(trending.scope, slug, trending.label, trending.description, locale);
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
    return await handleGenreFilter(slug, mediaType, locale);
  } catch (error) {
    console.error(`[discovery/shortcut] genre slug=${slug}`, error);
    return NextResponse.json({ ok: false, error: "Failed to load", slug }, { status: 500 });
  }
}


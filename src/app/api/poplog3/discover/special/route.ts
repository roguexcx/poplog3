import { NextRequest, NextResponse } from "next/server";

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

async function getWeeklyTrendingTitles(pages = 3) {
  const responses = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      tmdbFetch<TmdbListResponse>("/trending/all/week", {
        params: {
          page: i + 1,
          include_adult: false,
        },
      }),
    ),
  );

  const seen = new Set<string>();
  return responses
    .flatMap((response) => response.results ?? [])
    .filter((item) => item.media_type === "movie" || item.media_type === "tv")
    .filter((item) => {
      const key = `${item.media_type}-${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function cacheTrendingTitles(
  titles: ReturnType<typeof normalizeTmdbTitle>[],
  rawItems: TmdbTitleSummary[],
) {
  await Promise.allSettled(
    titles.map(async (title) => {
      const raw = rawItems.find(
        (item) => item.id === title.tmdb_id && item.media_type === title.media_type,
      );
      if (!raw) return;
      try {
        await upsertCachedTitle(title, raw);
      } catch {}
    }),
  );
}

// ── Anime ─────────────────────────────────────────────────────────────────────

async function getAnimeResults() {
  const trending = await getWeeklyTrendingTitles(5);
  const animeTrending = trending.filter((item) => {
    const genreIds = item.genre_ids ?? [];
    return item.original_language === "ja" && genreIds.includes(16);
  });

  const normalized = filterValidTitles(
    animeTrending.map((item) => normalizeTmdbTitle(item)),
  ).slice(0, 18);
  const popularSeries = normalized
    .filter((item) => item.media_type === "tv")
    .slice(0, 12);
  const popularMovies = normalized
    .filter((item) => item.media_type === "movie")
    .slice(0, 8);

  await cacheTrendingTitles(normalized, animeTrending);

  return {
    ok: true,
    special: "anime",
    label: "Animes",
    popular: normalized,
    topRated: [],
    popularSeries,
    popularMovies,
    results: normalized,
  };
}

// ── Plot Twist ────────────────────────────────────────────────────────────────

const PLOT_TWIST_GENRE_WEIGHTS = new Map<number, number>([
  [9648, 5], // Mystery
  [53, 4],   // Thriller
  [80, 3],   // Crime
  [878, 2],  // Science Fiction
  [18, 1],   // Drama
]);

type TmdbKeyword = {
  id: number;
  name: string;
};

type TmdbMovieKeywordsResponse = {
  id: number;
  keywords?: TmdbKeyword[];
};

type TmdbTvKeywordsResponse = {
  id: number;
  results?: TmdbKeyword[];
};

const PLOT_TWIST_KEYWORD_PATTERNS = [
  "plot twist",
  "twist ending",
  "surprise ending",
  "shocking twist",
  "unreliable narrator",
  "mind game",
  "psychological thriller",
  "whodunit",
  "conspiracy",
  "time loop",
  "alternate reality",
  "nonlinear timeline",
];

function keywordTwistScore(keywords: TmdbKeyword[]) {
  return keywords.reduce((score, keyword) => {
    const name = keyword.name.toLowerCase();
    const exactMatch = PLOT_TWIST_KEYWORD_PATTERNS.some(
      (pattern) => name === pattern,
    );
    if (exactMatch) return score + 12;

    const partialMatch = PLOT_TWIST_KEYWORD_PATTERNS.some((pattern) =>
      name.includes(pattern),
    );
    if (partialMatch) return score + 6;

    if (name.includes("twist")) return score + 5;
    if (name.includes("mystery")) return score + 3;
    if (name.includes("psychological")) return score + 3;
    return score;
  }, 0);
}

async function getTitleKeywords(item: TmdbTitleSummary): Promise<TmdbKeyword[]> {
  if (item.media_type === "movie") {
    const data = await tmdbFetch<TmdbMovieKeywordsResponse>(
      `/movie/${item.id}/keywords`,
    );
    return data.keywords ?? [];
  }

  if (item.media_type === "tv") {
    const data = await tmdbFetch<TmdbTvKeywordsResponse>(
      `/tv/${item.id}/keywords`,
    );
    return data.results ?? [];
  }

  return [];
}

function plotTwistTrendScore(item: TmdbTitleSummary, keywordScore = 0) {
  const genreScore = (item.genre_ids ?? []).reduce(
    (sum, genreId) => sum + (PLOT_TWIST_GENRE_WEIGHTS.get(genreId) ?? 0),
    0,
  );
  const voteScore = (item.vote_average ?? 0) / 2;
  const buzzScore = Math.log10((item.popularity ?? 0) + 1);
  return keywordScore * 10 + genreScore * 4 + voteScore + buzzScore;
}

async function getPlotTwistResults() {
  const trending = await getWeeklyTrendingTitles(5);
  const keywordSettled = await Promise.allSettled(
    trending.map(async (item) => {
      const keywords = await getTitleKeywords(item);
      return {
        item,
        keywordScore: keywordTwistScore(keywords),
      };
    }),
  );

  const scoredByKeyword = keywordSettled
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<{
        item: TmdbTitleSummary;
        keywordScore: number;
      }> => result.status === "fulfilled",
    )
    .map((result) => result.value)
    .filter((entry) => entry.keywordScore > 0)
    .sort(
      (a, b) =>
        plotTwistTrendScore(b.item, b.keywordScore) -
        plotTwistTrendScore(a.item, a.keywordScore),
    )
    .map((entry) => entry.item);

  const fallbackByGenre = trending
    .filter(
      (item) =>
        !scoredByKeyword.some(
          (keywordItem) =>
            keywordItem.id === item.id &&
            keywordItem.media_type === item.media_type,
        ) &&
        (item.genre_ids ?? []).some((genreId) =>
          PLOT_TWIST_GENRE_WEIGHTS.has(genreId),
        ),
    )
    .sort((a, b) => plotTwistTrendScore(b) - plotTwistTrendScore(a));

  const candidates = [...scoredByKeyword, ...fallbackByGenre];

  const valid = filterValidTitles(
    candidates.map((item) => normalizeTmdbTitle(item)),
  ).slice(0, 18);

  await cacheTrendingTitles(valid, candidates);

  return {
    ok: true,
    special: "plot-twist",
    label: "Plot Twist",
    popular: valid,
    results: valid,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const special = searchParams.get("special");

  try {
    if (special === "anime") {
      return NextResponse.json(await getAnimeResults());
    }

    if (special === "plot-twist") {
      return NextResponse.json(await getPlotTwistResults());
    }

    return NextResponse.json(
      { ok: false, error: "Unknown special filter. Use ?special=anime or ?special=plot-twist" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[poplog3/discover/special]", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load special discover data",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

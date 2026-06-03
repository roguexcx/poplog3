import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import { upsertCachedTitle } from "@/server/cache/title-cache";
import {
  findCachedFuzzyTitles,
  normalizeSearchTerm,
  shouldUseFuzzyFallback,
} from "@/server/search/fuzzy-title-search";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getUserFeedbackMap } from "@/lib/personalization/feedback";
import { applyUserFeedbackScoring } from "@/lib/personalization/scoring";

function fuzzyMatchToTmdbSummary(
  title: Awaited<ReturnType<typeof findCachedFuzzyTitles>>[number]
): TmdbTitleSummary {
  return {
    id: title.tmdb_id,
    media_type: title.media_type,
    title: title.media_type === "movie" ? title.title : undefined,
    name: title.media_type === "tv" ? title.title : undefined,
    original_title: title.media_type === "movie" ? title.original_title ?? undefined : undefined,
    original_name: title.media_type === "tv" ? title.original_title ?? undefined : undefined,
    overview: title.overview ?? undefined,
    poster_path: title.poster_path ?? null,
    backdrop_path: title.backdrop_path ?? null,
    release_date: title.release_date ?? undefined,
    first_air_date: title.first_air_date ?? undefined,
    last_air_date: title.last_air_date ?? null,
    genre_ids: title.genres,
    popularity: title.popularity ?? undefined,
    vote_average: title.vote_average ?? undefined,
    vote_count: title.vote_count ?? undefined,
    original_language: title.original_language ?? undefined,
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing search query. Use ?q=",
      },
      { status: 400 }
    );
  }

  try {
    // Resolve authenticated user for feedback metadata (best-effort).
    let userId: string | undefined;
    let feedbackMap: Awaited<ReturnType<typeof getUserFeedbackMap>> | undefined;
    try {
      const user = await getCurrentUser();
      if (user) {
        userId = user.id;
        feedbackMap = await getUserFeedbackMap(user.id);
      }
    } catch {
      // Unauthenticated -- proceed without personalization.
    }

    const data = await tmdbFetch<{
      results: TmdbTitleSummary[];
    }>("/search/multi", {
      params: {
        query,
        include_adult: false,
        page: 1,
      },
    });

    const rawResults = data.results.filter(
      (item) => item.media_type === "movie" || item.media_type === "tv"
    );

    const titles = filterValidTitles(
      rawResults.map((item) => normalizeTmdbTitle(item))
    );

    // Cache is best-effort -- do not block search results on cache failures.
    Promise.all(
      titles.map(async (title, index) => {
        try {
          await upsertCachedTitle(title, rawResults[index]);
        } catch (cacheError) {
          console.warn(
            `[poplog3/search] falha ao cachear ${title.media_type}/${title.tmdb_id}:`,
            cacheError instanceof Error ? cacheError.message : cacheError
          );
        }
      })
    ).catch(() => {/* silent */});

    const seenTitleKeys = new Set(
      titles.map((title) => `${title.media_type}-${title.tmdb_id}`)
    );
    const fuzzyTitles = shouldUseFuzzyFallback(titles.length, 1)
      ? await findCachedFuzzyTitles({
          query,
          mediaType: "all",
          excludeKeys: seenTitleKeys,
        })
      : [];
    const rawCombined = [...rawResults, ...fuzzyTitles.map(fuzzyMatchToTmdbSummary)];

    // Apply editorial feedback in search context: preserves TMDB order,
    // attaches userFeedback metadata (notInterested, activeTypes) for UI.
    // Hidden titles are NOT excluded from search (users can still find them).
    const results = applyUserFeedbackScoring(
      rawCombined.map((item) => ({ ...item, id: item.id })),
      {
        userId,
        feedbackMap,
        context: "search",
        preserveOrder: true,
      },
    );

    return NextResponse.json({
      ok: true,
      query,
      normalizedQuery: normalizeSearchTerm(query),
      count: results.length,
      fuzzyCount: fuzzyTitles.length,
      results,
    });
  } catch (error) {
    console.error("[poplog3/search]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to search TMDB",
        details:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

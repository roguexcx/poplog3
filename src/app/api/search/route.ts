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
import {
  catalogSearch,
  isBalloonerismSearchEnabled,
} from "@/server/source-engine/engine";
import {
  hydrateCatalogResultsWithDebug,
  type HydrationDebug,
} from "@/server/source-engine/hydrate-catalog-results";

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
  const debugSource = searchParams.get("debugSource") === "1";

  if (!query) {
    return NextResponse.json(
      { ok: false, error: "Missing search query. Use ?q=" },
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

    // ── Balloonerismm primary path ────────────────────────────────────────────
    let balloonerismmDebug: HydrationDebug | null = null;
    if (isBalloonerismSearchEnabled()) {
      try {
        const catalogResults = await catalogSearch({ query });
        const hydratedResult = await hydrateCatalogResultsWithDebug(catalogResults);
        const hydrated = hydratedResult.titles;
        balloonerismmDebug = hydratedResult.debug;
        const validTitles = filterValidTitles(hydrated);
        balloonerismmDebug.searchCompatibleCount = validTitles.length;

        if (validTitles.length > 0) {
          const seenKeys = new Set(
            validTitles.map((t) => `${t.media_type}-${t.tmdb_id}`)
          );
          const fuzzyTitles = shouldUseFuzzyFallback(validTitles.length, 1)
            ? await findCachedFuzzyTitles({ query, mediaType: "all", excludeKeys: seenKeys })
            : [];

          const rawCombined = [
            ...validTitles.map((t) => ({ ...t, id: t.tmdb_id })),
            ...fuzzyTitles.map(fuzzyMatchToTmdbSummary),
          ];

          const results = applyUserFeedbackScoring(rawCombined, {
            userId,
            feedbackMap,
            context: "search",
            preserveOrder: true,
          });

          console.log(
            `[search] source=balloonerismm count=${validTitles.length} fuzzy=${fuzzyTitles.length}`
          );

          return NextResponse.json({
            ok: true,
            query,
            normalizedQuery: normalizeSearchTerm(query),
            count: results.length,
            fuzzyCount: fuzzyTitles.length,
            results,
            ...(debugSource ? { debugSource: balloonerismmDebug } : {}),
          });
        }

        const fallbackReason = catalogResults.length === 0 ? "raw_empty" : "normalized_empty";
        balloonerismmDebug.fallbackUsed = true;
        balloonerismmDebug.fallbackReason = fallbackReason;
        console.log(`[search] source=balloonerismm_fallback reason=${fallbackReason}`);
      } catch (err) {
        balloonerismmDebug = {
          source: "balloonerismm",
          rawCount: 0,
          normalizedCount: 0,
          poplogResolvedCount: 0,
          searchCompatibleCount: 0,
          fallbackUsed: true,
          fallbackReason: "error",
          discardReasons: {},
          externalIdStats: {
            imdbId: 0,
            tmdbId: 0,
            tvdbId: 0,
            traktId: 0,
            balloonerismmId: 0,
            slug: 0,
            poplogResolved: 0,
            temporaryCandidates: 0,
          },
        };
        console.warn(
          "[search] source=balloonerismm_fallback reason=error",
          err instanceof Error ? err.message : err
        );
      }
    }

    // ── Legacy TMDB path (fallback) ──────────────────────────────────────────
    const data = await tmdbFetch<{ results: TmdbTitleSummary[] }>("/search/multi", {
      params: { query, include_adult: false, page: 1 },
    });

    const rawResults = data.results.filter(
      (item) => item.media_type === "movie" || item.media_type === "tv"
    );

    const titles = filterValidTitles(rawResults.map((item) => normalizeTmdbTitle(item)));

    Promise.all(
      titles.map(async (title, index) => {
        try {
          await upsertCachedTitle(title, rawResults[index]);
        } catch (cacheError) {
          console.warn(
            `[search] falha ao cachear ${title.media_type}/${title.tmdb_id}:`,
            cacheError instanceof Error ? cacheError.message : cacheError
          );
        }
      })
    ).catch(() => {/* silent */});

    const seenTitleKeys = new Set(titles.map((t) => `${t.media_type}-${t.tmdb_id}`));
    const fuzzyTitles = shouldUseFuzzyFallback(titles.length, 1)
      ? await findCachedFuzzyTitles({ query, mediaType: "all", excludeKeys: seenTitleKeys })
      : [];
    const rawCombined = [...rawResults, ...fuzzyTitles.map(fuzzyMatchToTmdbSummary)];

    const results = applyUserFeedbackScoring(
      rawCombined.map((item) => ({ ...item, id: item.id })),
      { userId, feedbackMap, context: "search", preserveOrder: true },
    );

    return NextResponse.json({
      ok: true,
      query,
      normalizedQuery: normalizeSearchTerm(query),
      count: results.length,
      fuzzyCount: fuzzyTitles.length,
      results,
      ...(debugSource && balloonerismmDebug ? { debugSource: balloonerismmDebug } : {}),
    });
  } catch (error) {
    console.error("[search]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to search",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

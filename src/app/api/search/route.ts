import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import {
  findCachedFuzzyTitles,
  normalizeSearchTerm,
  shouldUseFuzzyFallback,
} from "@/server/search/fuzzy-title-search";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getUserFeedbackMap } from "@/lib/personalization/feedback";
import { applyUserFeedbackScoring } from "@/lib/personalization/scoring";
import { catalogSearch } from "@/server/source-engine/engine";
import {
  hydrateCatalogResultsWithDebug,
  type HydrationDebug,
} from "@/server/source-engine/hydrate-catalog-results";
import { resolveLocaleScope } from "@/server/source-engine/locale";
import { sourceEngineLog } from "@/server/source-engine/source-log";
import { richSearchHandler } from "@/server/search/rich-search-handler";

type SearchTitleSummary = {
  id: number;
  media_type: "movie" | "tv";
  title?: string;
  name?: string;
  original_title?: string | null;
  original_name?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  last_air_date?: string | null;
  genre_ids?: unknown;
  popularity?: number | null;
  vote_average?: number | null;
  vote_count?: number | null;
  original_language?: string | null;
};

function fuzzyMatchToTmdbSummary(
  title: Awaited<ReturnType<typeof findCachedFuzzyTitles>>[number]
): SearchTitleSummary {
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

async function lightSearchHandler(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q")?.trim();
  const debugSource = searchParams.get("debugSource") === "1";
  const localeScope = resolveLocaleScope({
    language:
      searchParams.get("language") ??
      searchParams.get("locale") ??
      request.cookies.get("poplog_catalog_language")?.value,
    region: searchParams.get("region") ?? request.cookies.get("poplog_region")?.value,
  });

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

    let catalogDebug: HydrationDebug | null = null;
    try {
      const catalogResults = await catalogSearch({
        query,
        language: localeScope.catalogLanguage,
        region: localeScope.region,
      });
      const hydratedResult = await hydrateCatalogResultsWithDebug(catalogResults);
      const hydrated = hydratedResult.titles;
      catalogDebug = hydratedResult.debug;
      const validTitles = filterValidTitles(hydrated);
      catalogDebug.searchCompatibleCount = validTitles.length;

      if (validTitles.length > 0) {
        const seenKeys = new Set(
          validTitles.map((t) => `${t.media_type}-${t.tmdb_id}`)
        );
        const fuzzyTitles = shouldUseFuzzyFallback(validTitles.length, 1)
          ? await findCachedFuzzyTitles({
              query,
              mediaType: "all",
              excludeKeys: seenKeys,
              language: localeScope.catalogLanguage,
            })
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

        sourceEngineLog("search_resolved", {
          query,
          locale: localeScope.catalogLanguage,
          region: localeScope.region,
          count: validTitles.length,
          fuzzy: fuzzyTitles.length,
        });

        return NextResponse.json({
          ok: true,
          query,
          normalizedQuery: normalizeSearchTerm(query),
          language: localeScope.catalogLanguage,
          region: localeScope.region,
          count: results.length,
          fuzzyCount: fuzzyTitles.length,
          results,
          ...(debugSource ? { debugSource: catalogDebug } : {}),
        });
      }

      catalogDebug.fallbackUsed = true;
      catalogDebug.fallbackReason = catalogResults.length === 0 ? "raw_empty" : "normalized_empty";
      sourceEngineLog("search_fallback", {
        query,
        locale: localeScope.catalogLanguage,
        region: localeScope.region,
        reason: catalogDebug.fallbackReason,
      }, "warn");
    } catch (err) {
      catalogDebug = {
        source: "trakt",
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
          slug: 0,
          poplogResolved: 0,
          temporaryCandidates: 0,
        },
      };
      sourceEngineLog("search_fallback", {
        query,
        locale: localeScope.catalogLanguage,
        region: localeScope.region,
        reason: "error",
        error: err instanceof Error ? err.message : String(err),
      }, "warn");
    }

    const fuzzyTitles = await findCachedFuzzyTitles({
      query,
      mediaType: "all",
      language: localeScope.catalogLanguage,
    });
    const rawCombined = fuzzyTitles.map(fuzzyMatchToTmdbSummary);
    const results = applyUserFeedbackScoring(rawCombined, {
      userId,
      feedbackMap,
      context: "search",
      preserveOrder: true,
    });

    return NextResponse.json({
      ok: true,
      query,
      normalizedQuery: normalizeSearchTerm(query),
      language: localeScope.catalogLanguage,
      region: localeScope.region,
      count: results.length,
      fuzzyCount: fuzzyTitles.length,
      results,
      ...(debugSource
        ? {
            debugSource: catalogDebug ?? {
              source: "trakt",
              fallbackUsed: true,
              fallbackReason: "catalog_empty_or_unavailable",
              normalizedFrom: "local_cache",
              identityUsed: "poplog_id_or_best_alias",
              legacyCompatibilityUsed: true,
            },
          }
        : {}),
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

/**
 * Dispatcher do namespace canônico de busca.
 * - `/api/search`                          → tier leve (só títulos)
 * - `/api/search?include=people,companies` → tier rico (títulos + pessoas + empresas)
 * Mantém os dois comportamentos exatos sob uma URL bare única.
 */
export async function GET(request: NextRequest) {
  const include = request.nextUrl.searchParams.get("include");
  if (include && include.trim().length > 0) {
    return richSearchHandler(request);
  }
  return lightSearchHandler(request);
}

import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import {
  findCachedFuzzyTitles,
  normalizeSearchTerm,
  shouldUseFuzzyFallback,
} from "@/server/search/fuzzy-title-search";
import {
  catalogSearch,
  isBalloonerismSearchEnabled,
} from "@/server/source-engine/engine";
import {
  hydrateCatalogResultsWithDebug,
  resolveCatalogIdentityFields,
} from "@/server/source-engine/hydrate-catalog-results";

type SearchMediaType = "all" | "movie" | "tv";
const TMDB_MAX_SEARCH_PAGE = 500;

function parseMediaType(value: string | null): SearchMediaType {
  if (value === "movie" || value === "tv") return value;
  return "all";
}

function parsePage(value: string | null): number {
  const page = Number(value);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), TMDB_MAX_SEARCH_PAGE);
}

function parseGenre(value: string | null): number | undefined {
  if (!value) return undefined;
  const genre = Number(value);
  if (!Number.isFinite(genre)) return undefined;
  return Math.floor(genre);
}

// Maps SearchMediaType to CatalogSearch mediaType param
function toCatalogMediaType(type: SearchMediaType): "movie" | "show" | undefined {
  if (type === "movie") return "movie";
  if (type === "tv") return "show";
  return undefined;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const query = searchParams.get("q")?.trim();
  const mediaType = parseMediaType(searchParams.get("type"));
  const page = parsePage(searchParams.get("page"));
  const genre = parseGenre(searchParams.get("genre"));
  const debugSource = searchParams.get("debugSource") === "1";

  if (!query) {
    return NextResponse.json(
      { ok: false, error: "Missing search query. Use ?q=" },
      { status: 400 }
    );
  }

  try {
    // ── Balloonerismm primary path ────────────────────────────────────────────
    // Genre filter has no equivalent in Balloonerismm — use legacy for filtered queries.
    if (isBalloonerismSearchEnabled() && !genre && page === 1) {
      try {
        const catalogResults = await catalogSearch({
          query,
          mediaType: toCatalogMediaType(mediaType),
          page: 1,
        });
        const hydratedResult = await hydrateCatalogResultsWithDebug(catalogResults);
        const hydrated = hydratedResult.titles;

        // Apply genre filter if present (from local DB data)
        const filtered = genre
          ? hydrated.filter((t) => (t.genres ?? []).includes(genre))
          : hydrated;

        const validTitles = filterValidTitles(filtered);

        if (validTitles.length > 0) {
          const seenKeys = new Set(
            validTitles.map((t) => `${t.media_type}-${t.tmdb_id}`)
          );
          const fuzzyTitles = shouldUseFuzzyFallback(validTitles.length, page)
            ? await findCachedFuzzyTitles({ query, mediaType, genre, excludeKeys: seenKeys })
            : [];
          const results = [
            ...validTitles,
            ...fuzzyTitles.map((title) => ({
              ...title,
              ...resolveCatalogIdentityFields({
                ...title,
                externalIds: { tmdbId: title.tmdb_id },
              }, "cache-fuzzy"),
            })),
          ];

          console.log(
            `[poplog3/search] source=balloonerismm count=${validTitles.length} fuzzy=${fuzzyTitles.length}`
          );

          return NextResponse.json({
            ok: true,
            query,
            normalizedQuery: normalizeSearchTerm(query),
            type: mediaType,
            genre,
            page: 1,
            totalPages: 1,
            totalResults: results.length,
            count: results.length,
            fuzzyCount: fuzzyTitles.length,
            peopleCount: 0,
            results,
            people: [],
            ...(debugSource
              ? {
                  debugSource: {
                    ...hydratedResult.debug,
                    usedTmdbApi: false,
                    usedLegacy: false,
                    normalizedFrom: "balloonerismm",
                    identityUsed: "poplog_id_or_best_alias",
                    legacyCompatibilityUsed: true,
                  },
                }
              : {}),
          });
        }

        console.log("[poplog3/search] source=balloonerismm_fallback reason=empty");
      } catch (err) {
        console.warn(
          "[poplog3/search] source=balloonerismm_fallback reason=error",
          err instanceof Error ? err.message : err
        );
      }
    }

    const fuzzyTitles = await findCachedFuzzyTitles({ query, mediaType, genre });
    const results = fuzzyTitles.map((title) => ({
      ...title,
      ...resolveCatalogIdentityFields({
        ...title,
        externalIds: { tmdbId: title.tmdb_id },
      }, "legacy"),
    }));

    return NextResponse.json({
      ok: true,
      query,
      normalizedQuery: normalizeSearchTerm(query),
      type: mediaType,
      genre,
      page,
      totalPages: 1,
      totalResults: results.length,
      count: results.length,
      fuzzyCount: fuzzyTitles.length,
      peopleCount: 0,
      results,
      people: [],
      ...(debugSource
        ? {
            debugSource: {
              source: "local_cache",
              fallbackUsed: true,
              fallbackReason: "tmdb_fallback_blocked",
              usedTmdbApi: false,
              usedLegacy: false,
              normalizedFrom: "local_cache",
              identityUsed: "poplog_id_or_best_alias",
              legacyCompatibilityUsed: true,
            },
          }
        : {}),
    });
  } catch (error) {
    console.error("[poplog3/search]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to search titles",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getUserFeedbackMap } from "@/lib/personalization/feedback";
import { applyUserFeedbackScoring } from "@/lib/personalization/scoring";
import {
  catalogGetPopular,
  isBalloonerismDiscoverEnabled,
} from "@/server/source-engine/engine";
import {
  hydrateCatalogResultsWithDebug,
  resolveCatalogIdentityFields,
} from "@/server/source-engine/hydrate-catalog-results";
import { resolveLocaleScope } from "@/server/source-engine/locale";
import { db } from "@/server/db/client";

type MediaType = "movie" | "tv";
const DISCOVER_MIN_RESULTS = 5;
const DISCOVER_LOCAL_FALLBACK_LIMIT = 20;

async function fetchLocalPopular(mediaType: MediaType, language: string) {
  const rows = await db.poplog3Title.findMany({
    where: { mediaType, posterPath: { not: null } },
    orderBy: { popularity: "desc" },
    take: DISCOVER_LOCAL_FALLBACK_LIMIT,
    select: {
      id: true, tmdbId: true, mediaType: true, title: true, originalTitle: true,
      overview: true, posterPath: true, backdropPath: true,
      releaseDate: true, firstAirDate: true, year: true,
      voteAverage: true, popularity: true,
    },
  }).catch(() => []);

  const useOriginalTitle = language === "en-US";
  return rows
    .filter((row) => row.title ?? row.originalTitle)
    .map((row) => ({
      tmdb_id: row.tmdbId,
      id: row.tmdbId,
      media_type: mediaType,
      title: useOriginalTitle ? row.originalTitle ?? row.title ?? "" : row.title ?? row.originalTitle ?? "",
      original_title: useOriginalTitle ? null : row.originalTitle ?? null,
      overview: row.overview ?? null,
      poster_path: row.posterPath!,
      backdrop_path: row.backdropPath ?? null,
      release_date: mediaType === "movie" ? (row.releaseDate?.toISOString().slice(0, 10) ?? null) : null,
      first_air_date: mediaType === "tv" ? (row.firstAirDate?.toISOString().slice(0, 10) ?? null) : null,
      year: row.year ?? null,
      vote_average: row.voteAverage != null ? Number(row.voteAverage) : null,
      popularity: row.popularity != null ? Number(row.popularity) : null,
      poplogId: row.id,
      externalIds: { tmdbId: row.tmdbId },
      ...resolveCatalogIdentityFields({ tmdb_id: row.tmdbId, media_type: mediaType, poplogId: row.id }, "legacy"),
    }));
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mediaType = (searchParams.get("mediaType") as MediaType) || "movie";
  const debugSource = searchParams.get("debugSource") === "1";
  const localeScope = resolveLocaleScope({
    language:
      searchParams.get("language") ??
      searchParams.get("locale") ??
      request.cookies.get("poplog_catalog_language")?.value,
    region:
      searchParams.get("region") ??
      request.cookies.get("poplog_region")?.value,
  });

  if (mediaType !== "movie" && mediaType !== "tv") {
    return NextResponse.json({ ok: false, error: "Invalid media type" }, { status: 400 });
  }

  try {
    // Resolve authenticated user for editorial feedback scoring (best-effort).
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
    if (isBalloonerismDiscoverEnabled()) {
      try {
        const catalogMediaType = mediaType === "tv" ? "show" : "movie";
        const catalogResults = await catalogGetPopular({
          mediaType: catalogMediaType,
          language: localeScope.catalogLanguage,
          region: localeScope.region,
        });
        const hydratedResult = await hydrateCatalogResultsWithDebug(catalogResults);
        const hydrated = hydratedResult.titles;
        const validTitles = filterValidTitles(hydrated);
        const balloonerismmDebug = {
          ...hydratedResult.debug,
          usedTmdbApi: false,
          usedLegacy: false,
          normalizedFrom: "balloonerismm",
          identityUsed: "poplog_id_or_best_alias",
          legacyCompatibilityUsed: true,
        };

        if (validTitles.length >= DISCOVER_MIN_RESULTS) {
          const scoredTitles = applyUserFeedbackScoring(
            validTitles.map((t) => ({ ...t, id: t.tmdb_id, media_type: mediaType })),
            { userId, feedbackMap, context: "discovery", mediaType },
          );

          console.log(
            `[discover] source=balloonerismm mediaType=${mediaType} count=${scoredTitles.length}`
          );

          return NextResponse.json({
            ok: true,
            mediaType,
            count: scoredTitles.length,
            results: scoredTitles,
            ...(debugSource ? { debugSource: balloonerismmDebug } : {}),
          });
        }

        balloonerismmDebug.fallbackUsed = true;
        balloonerismmDebug.fallbackReason =
          validTitles.length < DISCOVER_MIN_RESULTS ? "insufficient" : "empty";
        console.log(
          `[discover] source=balloonerismm_fallback reason=${validTitles.length < DISCOVER_MIN_RESULTS ? "insufficient" : "empty"} mediaType=${mediaType}`
        );
      } catch (err) {
        console.warn(
          `[discover] source=balloonerismm_fallback reason=error mediaType=${mediaType}`,
          err instanceof Error ? err.message : err
        );
      }
    }

    // ── Local DB fallback ─────────────────────────────────────────────────────
    try {
      const localTitles = await fetchLocalPopular(mediaType, localeScope.catalogLanguage);
      if (localTitles.length >= DISCOVER_MIN_RESULTS) {
        const scoredTitles = applyUserFeedbackScoring(
          localTitles,
          { userId, feedbackMap, context: "discovery", mediaType },
        );
        console.log(`[discover] source=local_db mediaType=${mediaType} count=${scoredTitles.length}`);
        return NextResponse.json({
          ok: true,
          mediaType,
          count: scoredTitles.length,
          results: scoredTitles,
          ...(debugSource ? { debugSource: { source: "local_db", fallbackUsed: true, fallbackReason: "balloonerismm_insufficient_or_failed", usedTmdbApi: false, usedLegacy: false } } : {}),
        });
      }
    } catch {
      // ignore local fallback failure
    }

    return NextResponse.json({
      ok: true,
      mediaType,
      count: 0,
      results: [],
      ...(debugSource
        ? {
            debugSource: {
              source: "unavailable",
              fallbackUsed: true,
              fallbackReason: "all_sources_empty",
              usedTmdbApi: false,
              usedLegacy: false,
              normalizedFrom: "none",
              identityUsed: "none",
              legacyCompatibilityUsed: true,
            },
          }
        : {}),
    });
  } catch (error) {
    console.error("[discover route]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to fetch discover titles",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

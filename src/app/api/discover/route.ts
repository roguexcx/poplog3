import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getUserFeedbackMap } from "@/lib/personalization/feedback";
import { applyUserFeedbackScoring } from "@/lib/personalization/scoring";
import {
  catalogGetPopular,
  isBalloonerismDiscoverEnabled,
} from "@/server/source-engine/engine";
import { hydrateCatalogResults } from "@/server/source-engine/hydrate-catalog-results";

type MediaType = "movie" | "tv";
const DISCOVER_MIN_RESULTS = 5;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mediaType = (searchParams.get("mediaType") as MediaType) || "movie";

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
        const catalogResults = await catalogGetPopular({ mediaType: catalogMediaType });
        const hydrated = await hydrateCatalogResults(catalogResults);
        const validTitles = filterValidTitles(hydrated);

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
          });
        }

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

    // ── Legacy TMDB path (fallback) ──────────────────────────────────────────
    const data = await tmdbFetch<{ results: TmdbTitleSummary[] }>(`/discover/${mediaType}`, {
      params: { sort_by: "popularity.desc", page: 1 },
    });

    const titles = filterValidTitles(
      data.results.map((item) => normalizeTmdbTitle(item))
    );

    const scoredTitles = applyUserFeedbackScoring(
      titles.map((t) => ({ ...t, id: t.tmdb_id, media_type: mediaType })),
      { userId, feedbackMap, context: "discovery", mediaType },
    );

    return NextResponse.json({
      ok: true,
      mediaType,
      count: scoredTitles.length,
      results: scoredTitles,
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

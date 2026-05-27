import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { getUserFeedbackMap } from "@/lib/personalization/feedback";
import { applyUserFeedbackScoring } from "@/lib/personalization/scoring";

type MediaType = "movie" | "tv";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const mediaType =
    (searchParams.get("mediaType") as MediaType) || "movie";

  if (mediaType !== "movie" && mediaType !== "tv") {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid media type",
      },
      { status: 400 }
    );
  }

  try {
    // Resolve authenticated user for editorial feedback scoring (best-effort).
    let userId: string | undefined;
    let feedbackMap: Awaited<ReturnType<typeof getUserFeedbackMap>> | undefined;
    try {
      const supabase = await createSupabaseServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        userId = user.id;
        feedbackMap = await getUserFeedbackMap(user.id, supabase);
      }
    } catch {
      // Unauthenticated -- proceed without personalization.
    }

    const data = await tmdbFetch<{
      results: TmdbTitleSummary[];
    }>(`/discover/${mediaType}`, {
      params: {
        sort_by: "popularity.desc",
        page: 1,
      },
    });

    const titles = filterValidTitles(
      data.results.map((item) => normalizeTmdbTitle(item))
    );

    // Apply editorial scoring: not_interested penalizes score with reranking.
    // Uses "discovery" context -- hidden titles are kept (not excluded here).
    const scoredTitles = applyUserFeedbackScoring(
      titles.map((t) => ({ ...t, id: t.tmdb_id, media_type: mediaType })),
      {
        userId,
        feedbackMap,
        context: "discovery",
        mediaType,
      },
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
        details:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

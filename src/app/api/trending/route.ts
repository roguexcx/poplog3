import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";
import {
  formatEpisodeRuntimeLabel,
  formatRuntimeLabel,
} from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { supabaseAdmin } from "@/server/supabase/admin";
import { getSeriesEpisodeRuntimesMap } from "@/server/runtime/series-episode-runtimes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFeedbackMap } from "@/lib/personalization/feedback";
import { applyUserFeedbackScoring } from "@/lib/personalization/scoring";

export async function GET(_request: NextRequest) {
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
      // Unauthenticated or session error -- proceed without personalization.
    }

    const data = await tmdbFetch<{
      results: TmdbTitleSummary[];
    }>("/trending/all/week", {
      params: {
        page: 1,
      },
    });

    const titles = filterValidTitles(
      data.results.map((item) => normalizeTmdbTitle(item))
    );
    const tmdbIds = titles.map((title) => title.tmdb_id);
    const { data: cachedRows } =
      tmdbIds.length > 0
        ? await supabaseAdmin
            .from("poplog3_titles")
            .select("tmdb_id, media_type, runtime, episode_run_time")
            .in("tmdb_id", tmdbIds)
        : { data: [] };

    type CachedRuntimeRow = {
      tmdb_id: number;
      media_type: "movie" | "tv";
      runtime: number | null;
      episode_run_time: number[] | null;
    };

    const runtimeMap = new Map(
      ((cachedRows ?? []) as CachedRuntimeRow[]).map((row) => [
        `${row.media_type}-${row.tmdb_id}`,
        row,
      ])
    );
    const tvIds = titles
      .filter((title) => title.media_type === "tv")
      .map((title) => title.tmdb_id);
    const episodeRuntimesBySeries =
      tvIds.length > 0 ? await getSeriesEpisodeRuntimesMap(tvIds) : new Map();

    const withRuntime = titles.map((title) => {
      const cached = runtimeMap.get(`${title.media_type}-${title.tmdb_id}`);
      const runtimeResolution = resolveRuntimeByMediaType({
        mediaType: title.media_type,
        runtimeMinutes: cached?.runtime ?? title.runtime ?? null,
        episodeRunTime: cached?.episode_run_time ?? title.episode_run_time ?? null,
        episodes: episodeRuntimesBySeries.get(title.tmdb_id) ?? null,
      });
      const runtimeLabel =
        title.media_type === "tv"
          ? formatEpisodeRuntimeLabel(runtimeResolution.minutes, {
              estimated: runtimeResolution.estimated,
            })
          : formatRuntimeLabel(runtimeResolution.minutes, {
              estimated: runtimeResolution.estimated,
            });

      return {
        ...title,
        id: title.tmdb_id,
        runtime: runtimeResolution.minutes,
        runtime_label: runtimeLabel,
      };
    });

    // Apply editorial feedback scoring when user is authenticated.
    // preserveOrder: true keeps TMDB global rank but surfaces
    // userFeedback metadata (notInterested, activeTypes) for UI affordances.
    const results = applyUserFeedbackScoring(withRuntime, {
      userId,
      feedbackMap,
      context: "trending",
      preserveOrder: true,
    });

    return NextResponse.json({
      ok: true,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("[trending route]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to fetch trending titles",
        details:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

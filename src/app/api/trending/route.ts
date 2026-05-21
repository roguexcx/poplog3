import { NextResponse } from "next/server";
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

export async function GET() {
  try {
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

    const results = titles.map((title) => {
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
        runtime: runtimeResolution.minutes,
        runtime_label: runtimeLabel,
      };
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

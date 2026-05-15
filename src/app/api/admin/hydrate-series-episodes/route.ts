import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/server/supabase/admin";
import { syncTmdbSeason } from "@/server/sync/sync-tmdb-season";

export const dynamic = "force-dynamic";

type HydrationTarget = {
  series_tmdb_id: number;
  season_number: number;
};

type UserEpisodeRow = {
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
};

type CatalogEpisodeRow = {
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
};

type HydrationResult = HydrationTarget & {
  ok: boolean;
  episodes_before?: number;
  episodes_after?: number;
  error?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchAllRows<T>(
  table: string,
  select: string,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabaseAdmin
      .from(table)
      .select(select)
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...((data ?? []) as T[]));

    if (!data || data.length < pageSize) break;

    from += pageSize;
  }

  return rows;
}

export async function POST(request: Request) {
  const adminSecret = request.headers.get("x-admin-secret");

  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";
  const onlyMissing = url.searchParams.get("onlyMissing") === "true";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : null;

  try {
    const userEpisodes = await fetchAllRows<UserEpisodeRow>(
      "poplog3_user_episodes",
      "series_tmdb_id, season_number, episode_number"
    );

    let rows = userEpisodes;

    if (onlyMissing) {
      const catalogEpisodes = await fetchAllRows<CatalogEpisodeRow>(
        "poplog3_episodes",
        "series_tmdb_id, season_number, episode_number"
      );

      const catalogKeys = new Set(
        catalogEpisodes.map(
          (item) =>
            `${item.series_tmdb_id}:${item.season_number}:${item.episode_number}`
        )
      );

      rows = rows.filter(
        (item) =>
          !catalogKeys.has(
            `${item.series_tmdb_id}:${item.season_number}:${item.episode_number}`
          )
      );
    }

    const uniqueMap = new Map<string, HydrationTarget>();

    for (const row of rows) {
      const key = `${row.series_tmdb_id}:${row.season_number}`;
      uniqueMap.set(key, {
        series_tmdb_id: row.series_tmdb_id,
        season_number: row.season_number,
      });
    }

    const targets = Array.from(uniqueMap.values()).slice(
      0,
      limit && limit > 0 ? limit : undefined
    );

    const results: HydrationResult[] = [];

    for (const target of targets) {
      try {
        const before = await supabaseAdmin
          .from("poplog3_episodes")
          .select("id", { count: "exact", head: true })
          .eq("series_tmdb_id", target.series_tmdb_id)
          .eq("season_number", target.season_number);

        await syncTmdbSeason(target.series_tmdb_id, target.season_number, {
          force,
        });

        const after = await supabaseAdmin
          .from("poplog3_episodes")
          .select("id", { count: "exact", head: true })
          .eq("series_tmdb_id", target.series_tmdb_id)
          .eq("season_number", target.season_number);

        results.push({
          ...target,
          ok: true,
          episodes_before: before.count ?? 0,
          episodes_after: after.count ?? 0,
        });
      } catch (error) {
        results.push({
          ...target,
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }

      await sleep(120);
    }

    return NextResponse.json({
      ok: true,
      onlyMissing,
      total_user_episode_rows: userEpisodes.length,
      missing_user_episode_rows_before_targeting: onlyMissing
        ? rows.length
        : null,
      total: targets.length,
      hydrated: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
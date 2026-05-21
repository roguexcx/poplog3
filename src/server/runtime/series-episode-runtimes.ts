import type { EpisodeRuntimeInput } from "@/lib/runtime";
import { supabaseAdmin } from "@/server/supabase/admin";

type EpisodeRuntimeRow = {
  series_tmdb_id: number;
  season_number: number | null;
  episode_number: number | null;
  runtime: number | null;
  air_date: string | null;
};

export async function getSeriesEpisodeRuntimes(
  seriesTmdbId: number
): Promise<EpisodeRuntimeInput[]> {
  const map = await getSeriesEpisodeRuntimesMap([seriesTmdbId]);

  return map.get(seriesTmdbId) ?? [];
}

export async function getSeriesEpisodeRuntimesMap(
  seriesTmdbIds: number[]
): Promise<Map<number, EpisodeRuntimeInput[]>> {
  const ids = Array.from(
    new Set(
      seriesTmdbIds.filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  const map = new Map<number, EpisodeRuntimeInput[]>();

  if (ids.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("poplog3_episodes")
    .select("series_tmdb_id, season_number, episode_number, runtime, air_date")
    .in("series_tmdb_id", ids)
    .not("runtime", "is", null);

  if (error) {
    console.warn("[runtime] episode runtime lookup failed", error);
    return map;
  }

  for (const row of (data ?? []) as EpisodeRuntimeRow[]) {
    const list = map.get(row.series_tmdb_id) ?? [];

    list.push({
      seasonNumber: row.season_number,
      episodeNumber: row.episode_number,
      runtimeMinutes: row.runtime,
      airDate: row.air_date,
    });

    map.set(row.series_tmdb_id, list);
  }

  return map;
}

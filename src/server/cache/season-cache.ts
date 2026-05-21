import { supabaseAdmin } from "@/server/supabase/admin";
import type {
  PoplogEpisode,
  PoplogSeason,
} from "@/server/types/season";

export type UpsertSeasonInput = {
  seriesTmdbId: number;
  seasonNumber: number;
  tmdbSeasonId: number | null;
  name: string | null;
  overview: string | null;
  posterPath: string | null;
  airDate: string | null;
  episodeCount: number | null;
  voteAverage: number | null;
  tmdbPayload: unknown;
  episodes: Array<{
    episodeNumber: number;
    tmdbEpisodeId: number | null;
    name: string | null;
    overview: string | null;
    stillPath: string | null;
    airDate: string | null;
    runtime: number | null;
    voteAverage: number | null;
    voteCount: number | null;
    productionCode: string | null;
    episodeType: string | null;
  }>;
};

export async function getCachedEpisode(
  seriesTmdbId: number,
  seasonNumber: number,
  episodeNumber: number
): Promise<{
  name: string | null;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("poplog3_episodes")
    .select("name, still_path, air_date, runtime")
    .eq("series_tmdb_id", seriesTmdbId)
    .eq("season_number", seasonNumber)
    .eq("episode_number", episodeNumber)
    .maybeSingle();

  if (error) {
    console.error("[season-cache/get-episode]", error);
    return null;
  }
  return data ?? null;
}

export async function getCachedSeason(
  seriesTmdbId: number,
  seasonNumber: number
): Promise<PoplogSeason | null> {
  const { data: season, error: sErr } = await supabaseAdmin
    .from("title_seasons")
    .select(
      "series_tmdb_id, season_number, tmdb_season_id, name, overview, poster_path, air_date, episode_count, vote_average, last_synced_at"
    )
    .eq("series_tmdb_id", seriesTmdbId)
    .eq("season_number", seasonNumber)
    .maybeSingle();

  if (sErr) {
    console.error("[season-cache/get]", sErr);
    return null;
  }
  if (!season) return null;

  const { data: episodes, error: eErr } = await supabaseAdmin
    .from("poplog3_episodes")
    .select(
      "series_tmdb_id, season_number, episode_number, tmdb_episode_id, name, overview, still_path, air_date, runtime, vote_average, vote_count, production_code, episode_type"
    )
    .eq("series_tmdb_id", seriesTmdbId)
    .eq("season_number", seasonNumber)
    .order("episode_number", { ascending: true });

  if (eErr) {
    console.error("[season-cache/get-episodes]", eErr);
    return null;
  }

  return {
    ...season,
    episodes: (episodes ?? []) as PoplogEpisode[],
  } as PoplogSeason;
}

export function isSeasonCacheFresh(
  lastSyncedAt: string | null | undefined,
  maxAgeDays = 7
): boolean {
  if (!lastSyncedAt) return false;
  const t = new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(t)) return false;
  const ageDays = (Date.now() - t) / (24 * 60 * 60 * 1000);
  return ageDays <= maxAgeDays;
}

export async function upsertSeason(input: UpsertSeasonInput): Promise<void> {
  const now = new Date().toISOString();

  const { error: sErr } = await supabaseAdmin
    .from("title_seasons")
    .upsert(
      {
        series_tmdb_id: input.seriesTmdbId,
        season_number: input.seasonNumber,
        tmdb_season_id: input.tmdbSeasonId,
        name: input.name,
        overview: input.overview,
        poster_path: input.posterPath,
        air_date: input.airDate,
        episode_count: input.episodeCount,
        vote_average: input.voteAverage,
        tmdb_payload: input.tmdbPayload,
        last_synced_at: now,
        updated_at: now,
      },
      { onConflict: "series_tmdb_id,season_number" }
    );

  if (sErr) {
    console.error("[season-cache/upsert-season]", sErr);
    throw new Error(`Falha ao persistir temporada: ${sErr.message}`);
  }

  if (input.episodes.length === 0) return;

  const payload = input.episodes.map((e) => ({
    series_tmdb_id: input.seriesTmdbId,
    season_number: input.seasonNumber,
    episode_number: e.episodeNumber,
    tmdb_episode_id: e.tmdbEpisodeId,
    name: e.name,
    overview: e.overview,
    still_path: e.stillPath,
    air_date: e.airDate,
    runtime: e.runtime,
    vote_average: e.voteAverage,
    vote_count: e.voteCount,
    production_code: e.productionCode,
    episode_type: e.episodeType,
    last_synced_at: now,
    updated_at: now,
  }));

  const { error: eErr } = await supabaseAdmin
    .from("poplog3_episodes")
    .upsert(payload, {
      onConflict: "series_tmdb_id,season_number,episode_number",
    });

  if (eErr) {
    console.error("[season-cache/upsert-episodes]", eErr);
    throw new Error(`Falha ao persistir episodios: ${eErr.message}`);
  }
}

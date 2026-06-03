import {
  deleteSeasonCache,
  getCachedEpisodeRow,
  getCachedSeasonRow,
  isSeasonCacheFresh,
  upsertSeasonCache,
} from "@/server/repositories";
import type { PoplogEpisode, PoplogSeason } from "@/server/types/season";

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

function dateToString(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function episodeToLegacy(row: Awaited<ReturnType<typeof getCachedEpisodeRow>>): PoplogEpisode | null {
  if (!row) return null;
  return {
    series_tmdb_id: row.seriesTmdbId,
    season_number: row.seasonNumber,
    episode_number: row.episodeNumber,
    tmdb_episode_id: row.tmdbEpisodeId,
    name: row.name,
    overview: row.overview,
    still_path: row.stillPath,
    air_date: dateToString(row.airDate),
    runtime: row.runtime,
    vote_average: row.voteAverage === null ? null : Number(row.voteAverage),
    vote_count: row.voteCount,
    production_code: row.productionCode,
    episode_type: row.episodeType,
  } as PoplogEpisode;
}

export async function getCachedEpisode(
  seriesTmdbId: number,
  seasonNumber: number,
  episodeNumber: number,
): Promise<{
  name: string | null;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
} | null> {
  const row = await getCachedEpisodeRow(seriesTmdbId, seasonNumber, episodeNumber);
  if (!row) return null;
  return {
    name: row.name,
    still_path: row.stillPath,
    air_date: dateToString(row.airDate),
    runtime: row.runtime,
  };
}

export async function getCachedSeason(
  seriesTmdbId: number,
  seasonNumber: number,
): Promise<PoplogSeason | null> {
  const row = await getCachedSeasonRow(seriesTmdbId, seasonNumber);
  if (!row) return null;

  return {
    series_tmdb_id: row.seriesTmdbId,
    season_number: row.seasonNumber,
    tmdb_season_id: row.tmdbSeasonId,
    name: row.name,
    overview: row.overview,
    poster_path: row.posterPath,
    air_date: dateToString(row.airDate),
    episode_count: row.episodeCount,
    vote_average: row.voteAverage === null ? null : Number(row.voteAverage),
    last_synced_at: (row.lastSyncedAt ?? new Date(0)).toISOString(),
    episodes: row.episodes.map(episodeToLegacy).filter((episode): episode is PoplogEpisode => episode !== null),
  } as PoplogSeason;
}

export async function upsertSeason(input: UpsertSeasonInput): Promise<void> {
  const ok = await upsertSeasonCache(input);
  if (!ok) throw new Error(`Falha ao persistir temporada local ${input.seriesTmdbId}/${input.seasonNumber}`);
}

export async function deleteCachedSeason(seriesTmdbId: number, seasonNumber: number): Promise<boolean> {
  return deleteSeasonCache(seriesTmdbId, seasonNumber);
}

export { isSeasonCacheFresh };

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
  const local = await import("@/server/local-services/season-cache-local.service");
  return await local.getCachedEpisode(seriesTmdbId, seasonNumber, episodeNumber);
}

export async function getCachedSeason(
  seriesTmdbId: number,
  seasonNumber: number
): Promise<PoplogSeason | null> {
  const local = await import("@/server/local-services/season-cache-local.service");
  return await local.getCachedSeason(seriesTmdbId, seasonNumber);
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
  const local = await import("@/server/local-services/season-cache-local.service");
  await local.upsertSeason(input);
}

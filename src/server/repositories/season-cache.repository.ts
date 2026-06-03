import { db } from "@/server/db/client";

export type UpsertSeasonCacheInput = {
  seriesTmdbId: number;
  seasonNumber: number;
  tmdbSeasonId: number | null;
  name: string | null;
  overview: string | null;
  posterPath: string | null;
  airDate: string | Date | null;
  episodeCount: number | null;
  voteAverage: number | null;
  tmdbPayload: unknown;
  episodes: Array<{
    episodeNumber: number;
    tmdbEpisodeId: number | null;
    name: string | null;
    overview: string | null;
    stillPath: string | null;
    airDate: string | Date | null;
    runtime: number | null;
    voteAverage: number | null;
    voteCount: number | null;
    productionCode: string | null;
    episodeType: string | null;
  }>;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isSeasonCacheFresh(lastSyncedAt: string | Date | null | undefined, maxAgeDays = 7) {
  if (!lastSyncedAt) return false;
  const syncedTime = lastSyncedAt instanceof Date
    ? lastSyncedAt.getTime()
    : new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(syncedTime)) return false;
  return Date.now() - syncedTime <= maxAgeDays * 24 * 60 * 60 * 1000;
}

export async function getCachedEpisodeRow(
  seriesTmdbId: number,
  seasonNumber: number,
  episodeNumber: number,
) {
  try {
    return await db.poplog3Episode.findUnique({
      where: {
        seriesTmdbId_seasonNumber_episodeNumber: {
          seriesTmdbId,
          seasonNumber,
          episodeNumber,
        },
      },
    });
  } catch (error) {
    console.warn("[season-cache.repository] episode read failed", messageFromError(error));
    return null;
  }
}

export async function getCachedSeasonRow(seriesTmdbId: number, seasonNumber: number) {
  try {
    const season = await db.titleSeason.findUnique({
      where: { seriesTmdbId_seasonNumber: { seriesTmdbId, seasonNumber } },
    });
    if (!season) return null;

    const episodes = await db.poplog3Episode.findMany({
      where: { seriesTmdbId, seasonNumber },
      orderBy: { episodeNumber: "asc" },
    });

    return { ...season, episodes };
  } catch (error) {
    console.warn("[season-cache.repository] season read failed", messageFromError(error));
    return null;
  }
}

export async function upsertSeasonCache(input: UpsertSeasonCacheInput): Promise<boolean> {
  try {
    const now = new Date();
    await db.titleSeason.upsert({
      where: {
        seriesTmdbId_seasonNumber: {
          seriesTmdbId: input.seriesTmdbId,
          seasonNumber: input.seasonNumber,
        },
      },
      update: {
        tmdbSeasonId: input.tmdbSeasonId,
        name: input.name,
        overview: input.overview,
        posterPath: input.posterPath,
        airDate: toDate(input.airDate),
        episodeCount: input.episodeCount,
        voteAverage: input.voteAverage,
        tmdbPayload: input.tmdbPayload as object,
        lastSyncedAt: now,
      },
      create: {
        seriesTmdbId: input.seriesTmdbId,
        seasonNumber: input.seasonNumber,
        tmdbSeasonId: input.tmdbSeasonId,
        name: input.name,
        overview: input.overview,
        posterPath: input.posterPath,
        airDate: toDate(input.airDate),
        episodeCount: input.episodeCount,
        voteAverage: input.voteAverage,
        tmdbPayload: input.tmdbPayload as object,
        lastSyncedAt: now,
      },
    });

    for (const episode of input.episodes) {
      await db.poplog3Episode.upsert({
        where: {
          seriesTmdbId_seasonNumber_episodeNumber: {
            seriesTmdbId: input.seriesTmdbId,
            seasonNumber: input.seasonNumber,
            episodeNumber: episode.episodeNumber,
          },
        },
        update: {
          tmdbEpisodeId: episode.tmdbEpisodeId,
          name: episode.name,
          overview: episode.overview,
          stillPath: episode.stillPath,
          airDate: toDate(episode.airDate),
          runtime: episode.runtime,
          voteAverage: episode.voteAverage,
          voteCount: episode.voteCount,
          productionCode: episode.productionCode,
          episodeType: episode.episodeType,
          lastSyncedAt: now,
        },
        create: {
          seriesTmdbId: input.seriesTmdbId,
          seasonNumber: input.seasonNumber,
          episodeNumber: episode.episodeNumber,
          tmdbEpisodeId: episode.tmdbEpisodeId,
          name: episode.name,
          overview: episode.overview,
          stillPath: episode.stillPath,
          airDate: toDate(episode.airDate),
          runtime: episode.runtime,
          voteAverage: episode.voteAverage,
          voteCount: episode.voteCount,
          productionCode: episode.productionCode,
          episodeType: episode.episodeType,
          lastSyncedAt: now,
        },
      });
    }

    return true;
  } catch (error) {
    console.warn("[season-cache.repository] upsert failed", messageFromError(error));
    return false;
  }
}

export async function deleteSeasonCache(seriesTmdbId: number, seasonNumber: number): Promise<boolean> {
  try {
    await db.poplog3Episode.deleteMany({ where: { seriesTmdbId, seasonNumber } });
    await db.titleSeason.delete({ where: { seriesTmdbId_seasonNumber: { seriesTmdbId, seasonNumber } } });
    return true;
  } catch (error) {
    console.warn("[season-cache.repository] delete failed", messageFromError(error));
    return false;
  }
}

import { db } from "@/server/db/client";
import type { UserEpisode } from "@prisma/client";
import type { RepositoryResult, RepositoryVoidResult } from "./types";

export type EpisodeKey = `S${string}E${string}`;

export type UserSeriesProgress = {
  seriesTmdbId: number;
  watchedCount: number;
  totalEpisodes: number | null;
  airedEpisodes: number;
  lastWatchedAt: string | null;
  watchedKeys: EpisodeKey[];
  nextEpisode: {
    seasonNumber: number;
    episodeNumber: number;
    airDate: string | null;
  } | null;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function episodeKey(season: number, episode: number): EpisodeKey {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}` as EpisodeKey;
}

function isAired(airDate: Date | null, now = Date.now()) {
  return airDate !== null && Number.isFinite(airDate.getTime()) && airDate.getTime() <= now;
}

export async function upsertWatchedEpisode(input: {
  userId: string;
  seriesTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  runtimeMinutes?: number | null;
  watchedAt?: Date;
}): Promise<RepositoryResult<UserEpisode>> {
  try {
    const row = await db.userEpisode.upsert({
      where: {
        userId_seriesTmdbId_seasonNumber_episodeNumber: {
          userId: input.userId,
          seriesTmdbId: input.seriesTmdbId,
          seasonNumber: input.seasonNumber,
          episodeNumber: input.episodeNumber,
        },
      },
      update: {
        runtimeMinutes: input.runtimeMinutes ?? null,
        watchedAt: input.watchedAt ?? new Date(),
      },
      create: {
        userId: input.userId,
        seriesTmdbId: input.seriesTmdbId,
        seasonNumber: input.seasonNumber,
        episodeNumber: input.episodeNumber,
        runtimeMinutes: input.runtimeMinutes ?? null,
        watchedAt: input.watchedAt ?? new Date(),
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteWatchedEpisode(input: {
  userId: string;
  seriesTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
}): Promise<RepositoryVoidResult> {
  try {
    await db.userEpisode.deleteMany({
      where: input,
    });
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function clearSeasonProgress(input: {
  userId: string;
  seriesTmdbId: number;
  seasonNumber: number;
}): Promise<RepositoryResult<number>> {
  try {
    const result = await db.userEpisode.deleteMany({ where: input });
    return { ok: true, data: result.count };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function clearSeriesProgress(input: {
  userId: string;
  seriesTmdbId: number;
}): Promise<RepositoryResult<number>> {
  try {
    const result = await db.userEpisode.deleteMany({ where: input });
    return { ok: true, data: result.count };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function getWatchedEpisodesForSeries(input: {
  userId: string;
  seriesTmdbId: number;
}): Promise<RepositoryResult<UserEpisode[]>> {
  try {
    const rows = await db.userEpisode.findMany({
      where: input,
      orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
    });
    return { ok: true, data: rows };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function computeUserSeriesProgress(input: {
  userId: string;
  seriesTmdbId: number;
}): Promise<RepositoryResult<UserSeriesProgress>> {
  try {
    const now = Date.now();
    const [watched, episodes, title] = await Promise.all([
      db.userEpisode.findMany({
        where: {
          userId: input.userId,
          seriesTmdbId: input.seriesTmdbId,
        },
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
      }),
      db.poplog3Episode.findMany({
        where: {
          seriesTmdbId: input.seriesTmdbId,
          seasonNumber: { gt: 0 },
        },
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
      }),
      db.poplog3Title.findFirst({
        where: {
          mediaType: "tv",
          tmdbId: input.seriesTmdbId,
        },
        select: {
          numberOfEpisodes: true,
        },
      }),
    ]);

    const airedEpisodes = episodes.filter((episode) => isAired(episode.airDate, now));
    const validCatalogKeys = new Set(
      airedEpisodes.map((episode) => `${episode.seasonNumber}-${episode.episodeNumber}`),
    );
    const watchedValid = watched.filter((row) =>
      validCatalogKeys.has(`${row.seasonNumber}-${row.episodeNumber}`),
    );
    const watchedKeys = new Set(
      watchedValid.map((row) => `${row.seasonNumber}-${row.episodeNumber}`),
    );

    const next = airedEpisodes.find(
      (episode) => !watchedKeys.has(`${episode.seasonNumber}-${episode.episodeNumber}`),
    );
    const lastWatchedAt = watchedValid.length > 0
      ? watchedValid
          .map((row) => row.watchedAt)
          .sort((a, b) => b.getTime() - a.getTime())[0]
          .toISOString()
      : null;

    const cachedTotalEpisodes = episodes.filter((episode) => episode.airDate !== null).length || null;
    const knownTotalEpisodes =
      title?.numberOfEpisodes && title.numberOfEpisodes > 0
        ? Math.max(title.numberOfEpisodes, cachedTotalEpisodes ?? 0)
        : cachedTotalEpisodes;

    return {
      ok: true,
      data: {
        seriesTmdbId: input.seriesTmdbId,
        watchedCount: watchedValid.length,
        totalEpisodes: knownTotalEpisodes,
        airedEpisodes: airedEpisodes.length,
        lastWatchedAt,
        watchedKeys: watchedValid.map((row) => episodeKey(row.seasonNumber, row.episodeNumber)),
        nextEpisode: next
          ? {
              seasonNumber: next.seasonNumber,
              episodeNumber: next.episodeNumber,
              airDate: next.airDate?.toISOString().slice(0, 10) ?? null,
            }
          : null,
      },
    };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function computeBulkSeriesProgress(input: {
  userId: string;
  seriesTmdbIds: number[];
}): Promise<RepositoryResult<Map<number, UserSeriesProgress>>> {
  try {
    if (input.seriesTmdbIds.length === 0) {
      return { ok: true, data: new Map() };
    }
    const now = Date.now();
    const [watched, episodes, titles] = await Promise.all([
      db.userEpisode.findMany({
        where: { userId: input.userId, seriesTmdbId: { in: input.seriesTmdbIds } },
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
      }),
      db.poplog3Episode.findMany({
        where: { seriesTmdbId: { in: input.seriesTmdbIds }, seasonNumber: { gt: 0 } },
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
      }),
      db.poplog3Title.findMany({
        where: { mediaType: "tv", tmdbId: { in: input.seriesTmdbIds } },
        select: { tmdbId: true, numberOfEpisodes: true },
      }),
    ]);

    const watchedBySeries = new Map<number, typeof watched>();
    for (const row of watched) {
      if (!watchedBySeries.has(row.seriesTmdbId)) watchedBySeries.set(row.seriesTmdbId, []);
      watchedBySeries.get(row.seriesTmdbId)!.push(row);
    }
    const episodesBySeries = new Map<number, typeof episodes>();
    for (const ep of episodes) {
      if (!episodesBySeries.has(ep.seriesTmdbId)) episodesBySeries.set(ep.seriesTmdbId, []);
      episodesBySeries.get(ep.seriesTmdbId)!.push(ep);
    }
    const titleMap = new Map(titles.map((t) => [t.tmdbId, t]));

    const result = new Map<number, UserSeriesProgress>();
    for (const seriesId of input.seriesTmdbIds) {
      const seriesEpisodes = episodesBySeries.get(seriesId) ?? [];
      const seriesWatched = watchedBySeries.get(seriesId) ?? [];
      const title = titleMap.get(seriesId) ?? null;

      const airedEpisodes = seriesEpisodes.filter((ep) => isAired(ep.airDate, now));
      const validCatalogKeys = new Set(airedEpisodes.map((ep) => `${ep.seasonNumber}-${ep.episodeNumber}`));
      const watchedValid = seriesWatched.filter((row) => validCatalogKeys.has(`${row.seasonNumber}-${row.episodeNumber}`));
      const watchedKeysSet = new Set(watchedValid.map((row) => `${row.seasonNumber}-${row.episodeNumber}`));

      const next = airedEpisodes.find((ep) => !watchedKeysSet.has(`${ep.seasonNumber}-${ep.episodeNumber}`));
      const lastWatchedAt =
        watchedValid.length > 0
          ? watchedValid
              .map((r) => r.watchedAt)
              .sort((a, b) => b.getTime() - a.getTime())[0]
              .toISOString()
          : null;

      const cachedTotalEpisodes = seriesEpisodes.filter((ep) => ep.airDate !== null).length || null;
      const knownTotalEpisodes =
        title?.numberOfEpisodes && title.numberOfEpisodes > 0
          ? Math.max(title.numberOfEpisodes, cachedTotalEpisodes ?? 0)
          : cachedTotalEpisodes;

      result.set(seriesId, {
        seriesTmdbId: seriesId,
        watchedCount: watchedValid.length,
        totalEpisodes: knownTotalEpisodes,
        airedEpisodes: airedEpisodes.length,
        lastWatchedAt,
        watchedKeys: watchedValid.map((row) => episodeKey(row.seasonNumber, row.episodeNumber)),
        nextEpisode: next
          ? {
              seasonNumber: next.seasonNumber,
              episodeNumber: next.episodeNumber,
              airDate: next.airDate?.toISOString().slice(0, 10) ?? null,
            }
          : null,
      });
    }

    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

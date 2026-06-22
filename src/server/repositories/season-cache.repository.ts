import { db } from "@/server/db/client";

/** IDs externos por episódio provenientes de TVDB, Trakt, IMDb, etc. */
export type EpisodeExternalIds = {
  imdb?: string | null;
  tvdb?: number | string | null;
  trakt?: number | string | null;
  tmdb?: number | string | null;
  plex?: { guid?: string | null } | null;
};

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
    stillUrl?: string | null;
    stillSource?: string | null;
    stillWidth?: number | null;
    stillHeight?: number | null;
    stillLanguage?: string | null;
    airDate: string | Date | null;
    runtime: number | null;
    voteAverage: number | null;
    voteCount: number | null;
    productionCode: string | null;
    episodeType: string | null;
    absoluteNumber?: number | null;
    titleLanguage?: string | null;
    overviewLanguage?: string | null;
    originalTitle?: string | null;
    originalOverview?: string | null;
    sourcePriority?: unknown;
    imageCandidates?: unknown;
    textCandidates?: unknown;
    /** IDs externos: imdb, tvdb, trakt, tmdb, plex. Persistido como JSON para consultas futuras. */
    externalIds?: EpisodeExternalIds | null;
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

function isPortuguese(value: string | null | undefined): boolean {
  return /^(pt|por)(-|_|$)/i.test(value ?? "");
}

function looksPortugueseText(value: string | null | undefined): boolean {
  if (!value) return false;
  return /[áàâãéêíóôõúüç]/i.test(value) ||
    /\b(o|a|os|as|um|uma|de|do|da|dos|das|que|com|sem|para|por|não|muito|maior|gente|volta)\b/i.test(value);
}

function keepExistingPortuguese(
  existingText: string | null | undefined,
  existingLanguage: string | null | undefined,
  incomingText: string | null | undefined,
  incomingLanguage: string | null | undefined,
): string | undefined {
  if (!incomingText) return undefined;
  if (existingText && isPortuguese(existingLanguage) && looksPortugueseText(existingText) && !isPortuguese(incomingLanguage)) {
    return undefined;
  }
  return incomingText;
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
        tmdbSeasonId: input.tmdbSeasonId ?? undefined,
        name: input.name ?? undefined,
        overview: input.overview ?? undefined,
        posterPath: input.posterPath ?? undefined,
        airDate: input.airDate ? toDate(input.airDate) : undefined,
        episodeCount: input.episodeCount ?? undefined,
        voteAverage: input.voteAverage ?? undefined,
        tmdbPayload: input.tmdbPayload == null ? undefined : input.tmdbPayload as object,
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
      const where = {
        seriesTmdbId_seasonNumber_episodeNumber: {
          seriesTmdbId: input.seriesTmdbId,
          seasonNumber: input.seasonNumber,
          episodeNumber: episode.episodeNumber,
        },
      };
      const existing = await db.poplog3Episode.findUnique({ where });
      if (existing) {
        await db.poplog3Episode.update({
          where,
          data: {
          tmdbEpisodeId: episode.tmdbEpisodeId ?? undefined,
          name: keepExistingPortuguese(existing.name, existing.titleLanguage, episode.name, episode.titleLanguage),
          overview: keepExistingPortuguese(existing.overview, existing.overviewLanguage, episode.overview, episode.overviewLanguage),
          stillPath: episode.stillPath ?? undefined,
          stillUrl: episode.stillUrl ?? episode.stillPath ?? undefined,
          stillSource: episode.stillSource ?? undefined,
          stillWidth: episode.stillWidth ?? undefined,
          stillHeight: episode.stillHeight ?? undefined,
          stillLanguage: episode.stillLanguage ?? undefined,
          airDate: episode.airDate ? toDate(episode.airDate) : undefined,
          runtime: episode.runtime ?? undefined,
          voteAverage: episode.voteAverage ?? undefined,
          voteCount: episode.voteCount ?? undefined,
          productionCode: episode.productionCode ?? undefined,
          episodeType: episode.episodeType ?? undefined,
          absoluteNumber: episode.absoluteNumber ?? undefined,
          titleLanguage: episode.titleLanguage ?? undefined,
          overviewLanguage: episode.overviewLanguage ?? undefined,
          originalTitle: episode.originalTitle ?? undefined,
          originalOverview: episode.originalOverview ?? undefined,
          sourcePriority: episode.sourcePriority == null ? undefined : episode.sourcePriority as object,
          imageCandidatesJson: episode.imageCandidates == null ? undefined : episode.imageCandidates as object,
          textCandidatesJson: episode.textCandidates == null ? undefined : episode.textCandidates as object,
          externalIdsJson: episode.externalIds ?? undefined,
          lastSyncedAt: now,
          },
        });
      } else {
        await db.poplog3Episode.create({
          data: {
          seriesTmdbId: input.seriesTmdbId,
          seasonNumber: input.seasonNumber,
          episodeNumber: episode.episodeNumber,
          tmdbEpisodeId: episode.tmdbEpisodeId,
          name: episode.name,
          overview: episode.overview,
          stillPath: episode.stillPath,
          stillUrl: episode.stillUrl ?? episode.stillPath,
          stillSource: episode.stillSource,
          stillWidth: episode.stillWidth,
          stillHeight: episode.stillHeight,
          stillLanguage: episode.stillLanguage,
          airDate: toDate(episode.airDate),
          runtime: episode.runtime,
          voteAverage: episode.voteAverage,
          voteCount: episode.voteCount,
          productionCode: episode.productionCode,
          episodeType: episode.episodeType,
          absoluteNumber: episode.absoluteNumber,
          titleLanguage: episode.titleLanguage,
          overviewLanguage: episode.overviewLanguage,
          originalTitle: episode.originalTitle,
          originalOverview: episode.originalOverview,
          sourcePriority: episode.sourcePriority as object | undefined,
          imageCandidatesJson: episode.imageCandidates as object | undefined,
          textCandidatesJson: episode.textCandidates as object | undefined,
          externalIdsJson: episode.externalIds ?? undefined,
          lastSyncedAt: now,
          },
        });
      }
    }

    // poplog3_episodes is the canonical episode catalog. Keep the parent title in
    // sync with the greatest *aired* date already persisted, independently of
    // which route or hydrator called upsertSeason.
    const [airedCatalog, seasonCatalog] = await Promise.all([
      db.poplog3Episode.aggregate({
        where: {
          seriesTmdbId: input.seriesTmdbId,
          seasonNumber: { gt: 0 },
          airDate: { not: null, lte: now },
        },
        _max: { airDate: true },
        _count: { _all: true },
      }),
      db.titleSeason.aggregate({
        where: { seriesTmdbId: input.seriesTmdbId, seasonNumber: { gt: 0 } },
        _max: { seasonNumber: true },
      }),
    ]);

    if (airedCatalog._max.airDate) {
      const title = await db.poplog3Title.findUnique({
        where: {
          tmdbId_mediaType: {
            tmdbId: input.seriesTmdbId,
            mediaType: "tv",
          },
        },
        select: { lastAirDate: true, numberOfEpisodes: true, numberOfSeasons: true },
      });

      if (title) {
        await db.poplog3Title.update({
          where: {
            tmdbId_mediaType: {
              tmdbId: input.seriesTmdbId,
              mediaType: "tv",
            },
          },
          data: {
            ...(title.lastAirDate === null || title.lastAirDate < airedCatalog._max.airDate
              ? { lastAirDate: airedCatalog._max.airDate }
              : {}),
            ...(title.numberOfEpisodes === null || title.numberOfEpisodes < airedCatalog._count._all
              ? { numberOfEpisodes: airedCatalog._count._all }
              : {}),
            ...(seasonCatalog._max.seasonNumber !== null &&
            (title.numberOfSeasons === null || title.numberOfSeasons < seasonCatalog._max.seasonNumber)
              ? { numberOfSeasons: seasonCatalog._max.seasonNumber }
              : {}),
          },
        });
      }
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

import { db } from "@/server/db/client";
import { upsertSeason } from "@/server/cache/season-cache";
import {
  imdbIdFromSyntheticTmdbId,
  isSyntheticTmdbId,
} from "@/lib/ids/synthetic-tmdb-id";

import { resolveCanonicalSeason } from "./canonical-season-resolver";

export type SeriesEpisodeHydrationLog = {
  stage: string;
  message: string;
  details?: Record<string, unknown>;
};

export type SeriesEpisodeHydrationResult = {
  seriesTmdbId: number;
  seasonsAttempted: number;
  seasonsSaved: number;
  episodesSaved: number;
  ids: {
    imdbId: string | null;
    tvdbId: number | null;
    traktId: string | number | null;
  };
  logs: SeriesEpisodeHydrationLog[];
};

function log(
  logs: SeriesEpisodeHydrationLog[],
  stage: string,
  message: string,
  details?: Record<string, unknown>,
) {
  logs.push({ stage, message, details });
  console.log(`[series-hydrator] ${message}`, details ?? {});
}

function finitePositive(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

async function persistDiscoveredIds(input: {
  seriesTmdbId: number;
  imdbId?: string | null;
  tvdbId?: number | null;
  traktId?: string | number | null;
}) {
  if (!input.imdbId && !input.tvdbId && !input.traktId) return;

  await db.titleExternalId
    .upsert({
      where: { tmdbId_mediaType: { tmdbId: input.seriesTmdbId, mediaType: "tv" } },
      update: {
        imdbId: input.imdbId ?? undefined,
        tvdbId: input.tvdbId ? String(input.tvdbId) : undefined,
        traktId: input.traktId ? String(input.traktId) : undefined,
      },
      create: {
        tmdbId: input.seriesTmdbId,
        mediaType: "tv",
        imdbId: input.imdbId ?? undefined,
        tvdbId: input.tvdbId ? String(input.tvdbId) : undefined,
        traktId: input.traktId ? String(input.traktId) : undefined,
      },
    })
    .catch((error: Error) => {
      console.warn("[series-hydrator] falha ao persistir IDs externos", error.message);
    });
}

export async function hydrateSeriesEpisodesFromSources(input: {
  seriesTmdbId: number;
  imdbId?: string | null;
  tvdbId?: number | null;
  traktId?: string | number | null;
  title?: string | null;
  year?: number | null;
  numberOfSeasons?: number | null;
  includeSpecials?: boolean;
  force?: boolean;
}): Promise<SeriesEpisodeHydrationResult> {
  const logs: SeriesEpisodeHydrationLog[] = [];
  const seriesTmdbId = input.seriesTmdbId;

  const [titleRow, externalRow, existingSeasonCount] = await Promise.all([
    db.poplog3Title.findFirst({
      where: { tmdbId: seriesTmdbId, mediaType: "tv" },
      select: { title: true, year: true, numberOfSeasons: true },
    }).catch(() => null),
    db.titleExternalId.findFirst({
      where: { tmdbId: seriesTmdbId, mediaType: "tv" },
      select: { imdbId: true, tvdbId: true, traktId: true },
    }).catch(() => null),
    input.force
      ? Promise.resolve(0)
      : db.titleSeason.count({
          where: {
            seriesTmdbId,
            seasonNumber: input.includeSpecials ? { gte: 0 } : { gt: 0 },
          },
        }).catch(() => 0),
  ]);

  const syntheticImdb = isSyntheticTmdbId(seriesTmdbId)
    ? imdbIdFromSyntheticTmdbId(seriesTmdbId)
    : null;

  const imdbId = input.imdbId ?? syntheticImdb ?? externalRow?.imdbId ?? null;
  let tvdbId =
    input.tvdbId ??
    finitePositive(externalRow?.tvdbId) ??
    null;
  const traktId = input.traktId ?? externalRow?.traktId ?? null;
  const title = input.title ?? titleRow?.title ?? null;
  const year = input.year ?? titleRow?.year ?? null;
  const knownSeasonCount =
    input.numberOfSeasons ??
    titleRow?.numberOfSeasons ??
    null;

  log(logs, "identity", "IDs iniciais resolvidos", {
    seriesTmdbId,
    imdbId,
    tvdbId,
    traktId,
    title,
    year,
  });

  if (!imdbId && !traktId && title) {
    log(logs, "identity", "hidratação sem lookup externo auxiliar: aguardando ID Trakt/IMDb canônico", {
      title,
      year,
    });
  }

  if (!input.force && existingSeasonCount > 0) {
    log(logs, "cache", "hidratação ignorada: temporadas já existem no cache", {
      existingSeasonCount,
    });
    return {
      seriesTmdbId,
      seasonsAttempted: 0,
      seasonsSaved: 0,
      episodesSaved: 0,
      ids: { imdbId, tvdbId, traktId },
      logs,
    };
  }

  if (!imdbId && !tvdbId && !title) {
    log(logs, "identity", "hidratação cancelada: sem IDs ou título consultável");
    return {
      seriesTmdbId,
      seasonsAttempted: 0,
      seasonsSaved: 0,
      episodesSaved: 0,
      ids: { imdbId, tvdbId, traktId },
      logs,
    };
  }

  const maxSeason = Math.max(1, knownSeasonCount ?? 1);
  const seasonNumbers = [
    ...(input.includeSpecials ? [0] : []),
    ...Array.from({ length: maxSeason }, (_, index) => index + 1),
  ];

  let seasonsSaved = 0;
  let episodesSaved = 0;

  for (const seasonNumber of seasonNumbers) {
    const canonical = await resolveCanonicalSeason({
      tvdbId,
      imdbId,
      seasonNumber,
      title,
      year,
    }).catch((error: Error) => {
      log(logs, "season", "falha real ao resolver temporada", {
        seasonNumber,
        error: error.message,
      });
      return null;
    });

    if (canonical?.resolvedTvdbId && !tvdbId) {
      tvdbId = canonical.resolvedTvdbId;
      await persistDiscoveredIds({ seriesTmdbId, imdbId, tvdbId, traktId });
    }

    log(logs, "season", "temporada consultada", {
      seasonNumber,
      tvdbId,
      imdbId,
      sources: canonical?.mergedFrom ?? [],
      episodesFound: canonical?.episodes.length ?? 0,
      hasData: canonical?.hasData ?? false,
    });

    if (!canonical?.hasData || canonical.episodes.length === 0) continue;

    await upsertSeason({
      seriesTmdbId,
      seasonNumber,
      tmdbSeasonId: null,
      name: canonical.season.title ?? null,
      overview: null,
      posterPath: canonical.season.posterPath ?? null,
      airDate: canonical.season.airDate ?? null,
      episodeCount: canonical.season.episodeCount ?? canonical.episodes.length,
      voteAverage: null,
      tmdbPayload: {
        sources: canonical.mergedFrom,
        resolvedTvdbId: canonical.resolvedTvdbId,
        tvdbIdResolutionMethod: canonical.tvdbIdResolutionMethod,
      },
      episodes: canonical.episodes.map((ep) => ({
        episodeNumber: ep.number,
        tmdbEpisodeId: ep.ids.tmdbId ?? null,
        name: ep.title ?? null,
        overview: ep.overview ?? null,
        stillPath: ep.stillPath ?? null,
        stillUrl: ep.stillUrl ?? ep.stillPath ?? null,
        stillSource: ep.stillSource ?? null,
        stillWidth: ep.stillWidth ?? null,
        stillHeight: ep.stillHeight ?? null,
        stillLanguage: ep.stillLanguage ?? null,
        airDate: ep.firstAired ?? null,
        runtime: ep.runtime ?? null,
        voteAverage: null,
        voteCount: null,
        productionCode: null,
        episodeType: seasonNumber === 0 ? "special" : null,
        absoluteNumber: ep.absoluteNumber ?? null,
        titleLanguage: ep.titleLanguage ?? ep.textLanguage ?? null,
        overviewLanguage: ep.overviewLanguage ?? ep.textLanguage ?? null,
        originalTitle: ep.originalTitle ?? null,
        originalOverview: ep.originalOverview ?? null,
        sourcePriority: ep.sourcePriority ?? ep.mergedFrom,
        imageCandidates: ep.imageCandidates ?? null,
        textCandidates: ep.textCandidates ?? null,
        externalIds: (ep.ids.imdbId || ep.ids.tvdbId || ep.ids.traktId || ep.ids.tmdbId)
          ? {
              imdb: ep.ids.imdbId ?? null,
              tvdb: ep.ids.tvdbId ?? null,
              trakt: ep.ids.traktId ?? null,
              tmdb: ep.ids.tmdbId ?? null,
            }
          : null,
      })),
    });

    seasonsSaved += 1;
    episodesSaved += canonical.episodes.length;
    log(logs, "persist", "temporada e episódios salvos", {
      seasonNumber,
      episodesSaved: canonical.episodes.length,
      sources: canonical.mergedFrom,
    });
  }

  return {
    seriesTmdbId,
    seasonsAttempted: seasonNumbers.length,
    seasonsSaved,
    episodesSaved,
    ids: { imdbId, tvdbId, traktId },
    logs,
  };
}

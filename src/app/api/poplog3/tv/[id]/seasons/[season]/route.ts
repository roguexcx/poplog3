import { NextRequest, NextResponse } from "next/server";

import { withOrigin } from "@/server/engine-logger";
import { getCachedSeason } from "@/server/cache/season-cache";
import { resolvePoplogTitleIdentity } from "@/server/titles/poplog-title-identity";
import { getPoplogTitleDetails } from "@/server/titles/poplog-title-details";
import { normalizeSearchTerm } from "@/server/search/fuzzy-title-search";
import { db } from "@/server/db/client";
import { tvdbAdapter } from "@/server/source-engine/adapters/tvdb-adapter";
import type { CatalogEpisode, CatalogSeason } from "@/server/source-engine/types/catalog.types";
import type { PoplogTitleExternalIds } from "@/server/titles/poplog-title-identity";
import type { PoplogSeason } from "@/server/types/season";

type SeasonDebugSource = {
  poplogId: string | number | null;
  externalIds: PoplogTitleExternalIds;
  seriesIdentityUsed: string;
  seasonAliasLookupSource: string | null;
  seasonSource: "cache" | "tvdb" | "unavailable";
  episodeSource: "cache" | "tvdb" | "unavailable";
  usedTmdbApi: false;
  usedLegacy: false;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  incompleteSeasonData: boolean;
  missingSeasonCache: boolean;
  alternativeSourceUnavailable: boolean;
};

function createSeasonDebug(input: Omit<SeasonDebugSource, "usedTmdbApi" | "usedLegacy">): SeasonDebugSource {
  return {
    ...input,
    usedTmdbApi: false,
    usedLegacy: false,
  };
}

function seasonPayload(season: PoplogSeason, options?: {
  poplogId?: string | number | null;
  externalIds?: PoplogTitleExternalIds;
  debugSource?: SeasonDebugSource;
}) {
  const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
  const tmdbImage = (path: string | null, size: string) => {
    if (!path) return null;
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `${TMDB_IMAGE_BASE}/${size}${normalized}`;
  };

  return {
    ok: true,
    seriesTmdbId: season.series_tmdb_id,
    seasonNumber: season.season_number,
    name: season.name,
    overview: season.overview,
    posterUrl: tmdbImage(season.poster_path, "w342"),
    airDate: season.air_date,
    episodeCount: season.episode_count,
    voteAverage: season.vote_average,
    lastSyncedAt: season.last_synced_at,
    episodes: season.episodes.map((e) => ({
      episodeNumber: e.episode_number,
      name: e.name,
      overview: e.overview,
      stillUrl: tmdbImage(e.still_path, "w300"),
      airDate: e.air_date,
      runtime: e.runtime,
      voteAverage: e.vote_average,
      voteCount: e.vote_count,
      episodeType: e.episode_type,
    })),
    poplogId: options?.poplogId ?? null,
    externalIds: options?.externalIds ?? {},
    ...(options?.debugSource ? { debugSource: options.debugSource } : {}),
  };
}

function tvdbImage(value?: string | null) {
  return value ?? null;
}

function tvdbSeasonPayload(input: {
  seriesTmdbId: number;
  seasonNumber: number;
  season: CatalogSeason | null;
  episodes: CatalogEpisode[];
  poplogId: string | number | null;
  externalIds: PoplogTitleExternalIds;
  debugSource?: SeasonDebugSource;
}) {
  return {
    ok: true,
    seriesTmdbId: input.seriesTmdbId,
    seasonNumber: input.seasonNumber,
    name: input.season?.title ?? `Temporada ${input.seasonNumber}`,
    overview: null,
    posterUrl: tvdbImage(input.season?.posterPath),
    airDate: input.episodes
      .map((episode) => episode.firstAired)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null,
    episodeCount: input.episodes.length || null,
    voteAverage: null,
    lastSyncedAt: null,
    episodes: input.episodes
      .filter((episode) => episode.season === input.seasonNumber && episode.number > 0)
      .sort((a, b) => a.number - b.number)
      .map((episode) => ({
        episodeNumber: episode.number,
        name: episode.title ?? null,
        overview: episode.overview ?? null,
        stillUrl: tvdbImage(episode.stillPath),
        airDate: episode.firstAired ?? null,
        runtime: episode.runtime ?? null,
        voteAverage: null,
        voteCount: null,
        episodeType: null,
      })),
    poplogId: input.poplogId,
    externalIds: input.externalIds,
    ...(input.debugSource ? { debugSource: input.debugSource } : {}),
  };
}

function incompleteSeasonPayload(input: {
  seriesTmdbId: number | null;
  seasonNumber: number;
  poplogId: string | number | null;
  externalIds: PoplogTitleExternalIds;
  debugSource?: SeasonDebugSource;
}) {
  return {
    ok: true,
    incompleteSeasonData: true,
    seriesTmdbId: input.seriesTmdbId,
    seasonNumber: input.seasonNumber,
    name: `Temporada ${input.seasonNumber}`,
    overview: null,
    posterUrl: null,
    airDate: null,
    episodeCount: null,
    voteAverage: null,
    lastSyncedAt: null,
    episodes: [],
    poplogId: input.poplogId,
    externalIds: input.externalIds,
    ...(input.debugSource ? { debugSource: input.debugSource } : {}),
  };
}

async function findLocalSeriesByTitleYear(title?: string | null, year?: number | null) {
  if (!title || !year) return null;
  const normalized = normalizeSearchTerm(title);
  if (!normalized) return null;

  const rows = await db.poplog3Title.findMany({
    where: { mediaType: "tv", year },
    select: {
      id: true,
      tmdbId: true,
      title: true,
      originalTitle: true,
    },
    take: 80,
  }).catch(() => []);

  return rows.find((row) => {
    const candidates = [row.title, row.originalTitle]
      .map((value) => normalizeSearchTerm(value ?? ""))
      .filter(Boolean);
    return candidates.includes(normalized);
  }) ?? null;
}

async function findExternalIdsByTmdbId(tmdbId: number): Promise<PoplogTitleExternalIds> {
  const row = await db.titleExternalId.findFirst({
    where: { mediaType: "tv", tmdbId },
    select: { imdbId: true, tvdbId: true, traktId: true },
  }).catch(() => null);

  if (!row) return {};

  const tvdbId = row.tvdbId ? Number(row.tvdbId) : undefined;
  return {
    tmdbId,
    imdbId: row.imdbId ?? undefined,
    tvdbId: Number.isFinite(tvdbId) ? tvdbId : undefined,
    traktId: row.traktId ?? undefined,
    balloonerismmId: row.imdbId ?? undefined,
  };
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; season: string }>;
  }
) {
  const resolved = await params;
  const seasonNumber = Number(resolved.season);
  const debugSource = request.nextUrl.searchParams.get("debugSource") === "1";

  const refresh =
    request.nextUrl.searchParams.get("refresh") === "1" ||
    request.nextUrl.searchParams.get("force") === "1";

  if (Number.isNaN(seasonNumber) || seasonNumber <= 0) {
    // season_number = 0 = "Especiais" / temporadas fantasmas. TMDB retorna 404
    // para séries sem especiais, gerando erros desnecessários. Retornamos 400.
    console.warn("[poplog3/tv/season] número de temporada inválido (≤0 ou NaN)", {
      rawSeason: resolved.season,
      parsedSeason: seasonNumber,
      isNaN: Number.isNaN(seasonNumber),
      isZeroOrNegative: seasonNumber <= 0,
    });
    return NextResponse.json(
      { ok: false, error: "Invalid season number — must be >= 1" },
      { status: 400 }
    );
  }

  return withOrigin("title", async () => { try {
    const identity = await resolvePoplogTitleIdentity({
      mediaType: "tv",
      id: resolved.id,
    });
    let seriesTmdbId = identity.externalIds.tmdbId;
    let resolvedPoplogId = identity.poplogId ?? null;
    let externalIds = identity.externalIds;
    let seasonAliasLookupSource: string | null = null;

    if (!seriesTmdbId && identity.externalIds.imdbId) {
      const details = await getPoplogTitleDetails({
        mediaType: "tv",
        id: identity.externalIds.imdbId,
        sourceHint: "imdb",
      }).catch(() => null);
      const localByTitle = await findLocalSeriesByTitleYear(details?.title, details?.year);
      if (localByTitle) {
        const localExternalIds = await findExternalIdsByTmdbId(localByTitle.tmdbId);
        seriesTmdbId = localByTitle.tmdbId;
        resolvedPoplogId = localByTitle.id;
        externalIds = {
          ...externalIds,
          ...details?.externalIds,
          ...localExternalIds,
          tmdbId: localByTitle.tmdbId,
        };
        seasonAliasLookupSource = "localTitle:titleYearFromBalloonerismm";
      } else if (details?.externalIds.tmdbId) {
        seriesTmdbId = details.externalIds.tmdbId;
        resolvedPoplogId = details.poplogId ?? resolvedPoplogId;
        externalIds = { ...externalIds, ...details.externalIds };
        seasonAliasLookupSource = "balloonerismm:externalIds";
      }
    }
    const seriesIdentityUsed = identity.poplogId
      ? "poplog_id"
      : identity.externalIds.imdbId
        ? "imdb_id"
        : seriesTmdbId
          ? "tmdb_id_alias"
          : identity.externalIds.slug
            ? "slug"
            : "unknown";

    if (!seriesTmdbId) {
      const debug = createSeasonDebug({
        poplogId: resolvedPoplogId,
        externalIds,
        seriesIdentityUsed,
        seasonAliasLookupSource,
        seasonSource: "unavailable",
        episodeSource: "unavailable",
        fallbackUsed: true,
        fallbackReason: "missing_local_season_cache",
        incompleteSeasonData: true,
        missingSeasonCache: true,
        alternativeSourceUnavailable: true,
      });

      return NextResponse.json(
        incompleteSeasonPayload({
          seriesTmdbId: null,
          seasonNumber,
          poplogId: resolvedPoplogId,
          externalIds,
          debugSource: debugSource ? debug : undefined,
        }),
      );
    }

    console.log("[poplog3/tv/season] iniciando sincronização", {
      requestedId: resolved.id,
      poplogId: resolvedPoplogId,
      seriesTmdbId,
      seasonNumber,
      refresh,
    });

    const cached = !refresh ? await getCachedSeason(seriesTmdbId, seasonNumber) : null;
    if (cached) {
      const debug = createSeasonDebug({
        poplogId: resolvedPoplogId,
        externalIds,
        seriesIdentityUsed,
        seasonAliasLookupSource,
        seasonSource: "cache",
        episodeSource: "cache",
        fallbackUsed: false,
        fallbackReason: null,
        incompleteSeasonData: cached.episodes.length === 0,
        missingSeasonCache: false,
        alternativeSourceUnavailable: false,
      });

      return NextResponse.json(
        seasonPayload(cached, {
          poplogId: resolvedPoplogId,
          externalIds,
          debugSource: debugSource ? debug : undefined,
        }),
        {
          headers: {
            "x-poplog-source": "cache",
            "x-poplog-cache": "fresh",
          },
        },
      );
    }

    if (externalIds.tvdbId) {
      const [seasons, episodes] = await Promise.all([
        tvdbAdapter.getSeasons({ tvdbId: externalIds.tvdbId, season: seasonNumber }).catch(() => []),
        tvdbAdapter.getEpisodes({ tvdbId: externalIds.tvdbId, season: seasonNumber }).catch(() => []),
      ]);
      const season = seasons.find((item) => item.number === seasonNumber) ?? null;

      if (season || episodes.length > 0) {
        const debug = createSeasonDebug({
          poplogId: resolvedPoplogId,
          externalIds,
          seriesIdentityUsed,
          seasonAliasLookupSource,
          seasonSource: "tvdb",
          episodeSource: "tvdb",
          fallbackUsed: false,
          fallbackReason: null,
          incompleteSeasonData: episodes.length === 0,
          missingSeasonCache: true,
          alternativeSourceUnavailable: false,
        });

        return NextResponse.json(
          tvdbSeasonPayload({
            seriesTmdbId,
            seasonNumber,
            season,
            episodes,
            poplogId: resolvedPoplogId,
            externalIds,
            debugSource: debugSource ? debug : undefined,
          }),
          {
            headers: {
              "x-poplog-source": "tvdb",
              "x-poplog-cache": "external_no_persist",
            },
          },
        );
      }
    }

    const debug = createSeasonDebug({
      poplogId: resolvedPoplogId,
      externalIds,
      seriesIdentityUsed,
      seasonAliasLookupSource,
      seasonSource: "unavailable",
      episodeSource: "unavailable",
      fallbackUsed: true,
      fallbackReason: externalIds.tvdbId
        ? "season_data_incomplete_without_tmdb"
        : "alternative_source_unavailable",
      incompleteSeasonData: true,
      missingSeasonCache: true,
      alternativeSourceUnavailable: true,
    });

    return NextResponse.json(incompleteSeasonPayload({
      seriesTmdbId,
      seasonNumber,
      poplogId: resolvedPoplogId,
      externalIds,
      debugSource: debugSource ? debug : undefined,
    }), {
      headers: {
        "x-poplog-source": "unavailable",
        "x-poplog-cache": "missing",
      },
    });
  } catch (error) {
    console.error("[poplog3/tv/season] erro:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to fetch season",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
  }); // withOrigin("title")
}

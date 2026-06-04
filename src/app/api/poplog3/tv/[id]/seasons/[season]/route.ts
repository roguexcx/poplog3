import { NextRequest, NextResponse } from "next/server";

import { withOrigin } from "@/server/engine-logger";
import { syncTmdbSeason } from "@/server/sync/sync-tmdb-season";
import { getCachedSeason } from "@/server/cache/season-cache";
import { resolvePoplogTitleIdentity } from "@/server/titles/poplog-title-identity";
import { getPoplogTitleDetails } from "@/server/titles/poplog-title-details";
import { normalizeSearchTerm } from "@/server/search/fuzzy-title-search";
import { db } from "@/server/db/client";
import type { PoplogSeason } from "@/server/types/season";

function seasonPayload(season: PoplogSeason) {
  const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
  const tmdbImage = (path: string | null, size: string) => {
    if (!path) return null;
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `${TMDB_IMAGE_BASE}/${size}${normalized}`;
  };

  return {
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
        seriesTmdbId = localByTitle.tmdbId;
        resolvedPoplogId = localByTitle.id;
        externalIds = {
          ...externalIds,
          ...details?.externalIds,
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
      return NextResponse.json(
        {
          ok: false,
          error: "Season source id unavailable",
          poplogId: identity.poplogId ?? null,
          externalIds,
          ...(debugSource
            ? {
                debugSource: {
                  seriesIdentityUsed,
                  seasonSource: "unavailable",
                  episodeSource: "unavailable",
                  externalIds,
                  usedTmdbApi: false,
                  usedLegacy: false,
                  fallbackUsed: true,
                  fallbackReason: "missing_tmdb_alias_for_existing_season_cache",
                },
              }
            : {}),
        },
        { status: 404 },
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
    const result = cached
      ? { season: cached, source: "cache" as const, cache_status: "fresh" as const }
      : await syncTmdbSeason(seriesTmdbId, seasonNumber, { force: refresh });

    if (!result.season) {
      // season null = TMDB retornou 404 ou série não encontrada.
      // Retornamos 404 para o cliente, mas com mensagem informativa
      // para facilitar diagnóstico (sem tratar como erro grave no servidor).
      console.warn("[poplog3/tv/season] season não encontrada — provavelmente TMDB 404", {
        requestedId: resolved.id,
        seriesTmdbId,
        seasonNumber,
        source: result.source,
        cacheStatus: result.cache_status,
        hint: "Verifique se o tmdb_id corresponde a uma série (não a um filme) e se a temporada existe no TMDB",
      });
      return NextResponse.json(
        {
          ok: false,
          error: "Season not found",
          hint: `Série ${seriesTmdbId} temporada ${seasonNumber} não encontrada no cache/local ou fallback legado.`,
          ...(debugSource
            ? {
                debugSource: {
                  seriesIdentityUsed,
                  seasonAliasLookupSource,
                  seasonSource: result.source,
                  episodeSource: result.source,
                  externalIds,
                  usedTmdbApi: result.source === "tmdb",
                  usedLegacy: result.source === "tmdb",
                  fallbackUsed: true,
                  fallbackReason: "season_not_found",
                },
              }
            : {}),
        },
        { status: 404 }
      );
    }

    console.log("[poplog3/tv/season] season sincronizada com sucesso", {
      requestedId: resolved.id,
      seriesTmdbId,
      seasonNumber,
      episodeCount: result.season.episodes?.length ?? 0,
      source: result.source,
      cacheStatus: result.cache_status,
    });

    const payload = {
      ...seasonPayload(result.season),
      poplogId: resolvedPoplogId,
      externalIds,
      ...(debugSource
        ? {
            debugSource: {
              seriesIdentityUsed,
              seasonAliasLookupSource,
              seasonSource: result.source,
              episodeSource: result.source,
              externalIds,
              usedTmdbApi: result.source === "tmdb",
              usedLegacy: result.source === "tmdb",
              fallbackUsed: result.source === "tmdb",
              fallbackReason: result.source === "tmdb" ? "legacy_tmdb_season_fallback" : null,
            },
          }
        : {}),
    };

    return NextResponse.json(payload, {
      headers: {
        "x-poplog-source": result.source,
        "x-poplog-cache": result.cache_status,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Se é um erro 404 do TMDB, provavelmente o ID não existe em TMDB
    if (errorMsg.includes("404") || errorMsg.includes("not found")) {
      console.error("[poplog3/tv/season] TMDB retornou 404 - série pode não existir em TMDB", {
        requestedId: resolved.id,
        seasonNumber,
        error: errorMsg,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "Season not found in TMDB",
          details: `TMDB não encontrou a série ${resolved.id} ou a temporada ${seasonNumber}. ` +
                   `O ID pode ser inválido ou a série foi removida de TMDB.`,
        },
        { status: 404 }
      );
    }

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

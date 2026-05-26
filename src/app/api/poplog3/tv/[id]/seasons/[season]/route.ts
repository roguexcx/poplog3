import { NextRequest, NextResponse } from "next/server";

import { withOrigin } from "@/server/engine-logger";
import { syncTmdbSeason } from "@/server/sync/sync-tmdb-season";

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; season: string }>;
  }
) {
  const resolved = await params;
  const seriesId = Number(resolved.id);
  const seasonNumber = Number(resolved.season);

  const refresh =
    request.nextUrl.searchParams.get("refresh") === "1" ||
    request.nextUrl.searchParams.get("force") === "1";

  // Validação: seriesId deve ser um número positivo válido
  if (Number.isNaN(seriesId) || seriesId <= 0) {
    console.warn("[poplog3/tv/season] ID de série inválido", {
      rawId: resolved.id,
      parsedId: seriesId,
      isNaN: Number.isNaN(seriesId),
      isZeroOrNegative: seriesId <= 0,
    });
    return NextResponse.json(
      { ok: false, error: "Invalid TMDB series id" },
      { status: 400 }
    );
  }
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
    console.log("[poplog3/tv/season] iniciando sincronização", {
      seriesId,
      seasonNumber,
      refresh,
    });

    const result = await syncTmdbSeason(seriesId, seasonNumber, {
      force: refresh,
    });

    if (!result.season) {
      // season null = TMDB retornou 404 ou série não encontrada.
      // Retornamos 404 para o cliente, mas com mensagem informativa
      // para facilitar diagnóstico (sem tratar como erro grave no servidor).
      console.warn("[poplog3/tv/season] season não encontrada — provavelmente TMDB 404", {
        seriesId,
        seasonNumber,
        source: result.source,
        cacheStatus: result.cache_status,
        hint: "Verifique se o tmdb_id corresponde a uma série (não a um filme) e se a temporada existe no TMDB",
      });
      return NextResponse.json(
        { ok: false, error: "Season not found", hint: `Série ${seriesId} temporada ${seasonNumber} não encontrada no TMDB. Verifique se o ID é de uma série válida.` },
        { status: 404 }
      );
    }

    console.log("[poplog3/tv/season] season sincronizada com sucesso", {
      seriesId,
      seasonNumber,
      episodeCount: result.season.episodes?.length ?? 0,
      source: result.source,
      cacheStatus: result.cache_status,
    });

    const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
    const tmdbImage = (path: string | null, size: string) => {
      if (!path) return null;
      const normalized = path.startsWith("/") ? path : `/${path}`;
      return `${TMDB_IMAGE_BASE}/${size}${normalized}`;
    };

    const payload = {
      seriesTmdbId: result.season.series_tmdb_id,
      seasonNumber: result.season.season_number,
      name: result.season.name,
      overview: result.season.overview,
      posterUrl: tmdbImage(result.season.poster_path, "w342"),
      airDate: result.season.air_date,
      episodeCount: result.season.episode_count,
      voteAverage: result.season.vote_average,
      lastSyncedAt: result.season.last_synced_at,
      episodes: result.season.episodes.map((e) => ({
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
        seriesId,
        seasonNumber,
        error: errorMsg,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "Season not found in TMDB",
          details: `TMDB não encontrou a série ${seriesId} ou a temporada ${seasonNumber}. ` +
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

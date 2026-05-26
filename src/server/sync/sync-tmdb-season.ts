import { logApiCall } from "@/server/engine-logger";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";

import {
  getCachedSeason,
  isSeasonCacheFresh,
  upsertSeason,
} from "@/server/cache/season-cache";
import type { PoplogSeason } from "@/server/types/season";

type TmdbEpisodePayload = {
  id: number;
  episode_number: number;
  season_number: number;
  name: string | null;
  overview: string | null;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
  vote_average: number | null;
  vote_count: number | null;
  production_code: string | null;
  episode_type?: string | null;
};

type TmdbSeasonPayload = {
  id: number;
  name: string | null;
  overview: string | null;
  poster_path: string | null;
  air_date: string | null;
  season_number: number;
  vote_average?: number | null;
  episodes?: TmdbEpisodePayload[];
};

export type SyncTmdbSeasonResult = {
  season: PoplogSeason | null;
  source: "cache" | "tmdb";
  cache_status: "fresh" | "created" | "stale_refreshed" | "force_refreshed";
};

export async function syncTmdbSeason(
  seriesTmdbId: number,
  seasonNumber: number,
  options: { force?: boolean } = {}
): Promise<SyncTmdbSeasonResult> {
  // ── Validações defensivas ─────────────────────────────────────────────────
  // Impede chamadas inválidas ao TMDB antes de qualquer I/O.
  if (!Number.isFinite(seriesTmdbId) || seriesTmdbId <= 0) {
    console.warn("[syncTmdbSeason] seriesTmdbId inválido — abortando chamada TMDB", {
      seriesTmdbId, seasonNumber,
    });
    return { season: null, source: "cache", cache_status: "fresh" };
  }
  if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) {
    // season_number = 0 = "Especiais" (Season 0); TMDB retorna 404 para a maioria
    // das séries que não possuem especiais cadastrados. Temporadas com número ≤ 0
    // são consideradas fantasmas e não devem disparar chamadas externas.
    console.warn("[syncTmdbSeason] season_number inválido (≤0) — ignorando temporada especial/fantasma", {
      seriesTmdbId, seasonNumber,
    });
    return { season: null, source: "cache", cache_status: "fresh" };
  }
  // ─────────────────────────────────────────────────────────────────────────
  const t0 = Date.now();
  const cached = await getCachedSeason(seriesTmdbId, seasonNumber);

  if (
    !options.force &&
    cached &&
    isSeasonCacheFresh(cached.last_synced_at)
  ) {
    logApiCall({
      api: "tmdb",
      op: "sync-season",
      mediaType: "tv",
      tmdbId: seriesTmdbId,
      endpoint: `/tv/${seriesTmdbId}/season/${seasonNumber}`,
      cacheStatus: "hit",
      durationMs: Date.now() - t0,
      success: true,
    });
    return { season: cached, source: "cache", cache_status: "fresh" };
  }

  // Tenta pt-BR; se overview vier vazia em algum episodio o fallback en-US
  // entra na proxima rodada de sync.
  const tmdbEndpoint = `/tv/${seriesTmdbId}/season/${seasonNumber}`;

  console.log("[syncTmdbSeason] requisitando TMDB", {
    seriesTmdbId,
    seasonNumber,
    endpoint: tmdbEndpoint,
  });

  let data: TmdbSeasonPayload | null = null;
  try {
    data = await tmdbFetch<TmdbSeasonPayload>(
      tmdbEndpoint,
      {
        params: {
          language: "pt-BR",
        },
      }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[syncTmdbSeason] erro na requisição TMDB", {
      seriesTmdbId,
      seasonNumber,
      endpoint: tmdbEndpoint,
      error: errorMsg,
      note: "Se erro é '404', a série ou temporada pode não existir em TMDB",
    });
    // Re-throw com contexto adicional
    if (errorMsg.includes("404")) {
      // TMDB retornou 404. Causas esperadas:
      //   - tmdb_id é de um FILME (media_type mismatch no banco)
      //   - série foi removida do TMDB
      //   - season_number não existe para esta série
      // Não relança como erro fatal — deixa o caller tratar com fallback.
      console.warn("[syncTmdbSeason] TMDB 404 — série ou temporada não encontrada no TMDB", {
        seriesTmdbId,
        seasonNumber,
        endpoint: tmdbEndpoint,
        possibleCauses: [
          "ID pode ser de um filme registrado como série no banco",
          "Série removida ou inativa no TMDB",
          "Temporada não existe para esta série",
        ],
      });
      return { season: null, source: "tmdb", cache_status: "fresh" };
    }
    throw error;
  }

  if (!data || typeof data.id !== "number") {
    console.error("[syncTmdbSeason] payload TMDB inválido", {
      seriesTmdbId,
      seasonNumber,
      dataId: data?.id,
      dataType: typeof data?.id,
    });
    throw new Error(`TMDB season ${seriesTmdbId}/${seasonNumber} payload invalido.`);
  }

  await upsertSeason({
    seriesTmdbId,
    seasonNumber,
    tmdbSeasonId: data.id,
    name: data.name ?? null,
    overview: data.overview ?? null,
    posterPath: data.poster_path ?? null,
    airDate: data.air_date ?? null,
    episodeCount: data.episodes?.length ?? null,
    voteAverage:
      typeof data.vote_average === "number" ? data.vote_average : null,
    tmdbPayload: data,
    episodes: (data.episodes ?? []).map((e) => ({
      episodeNumber: e.episode_number,
      tmdbEpisodeId: e.id,
      name: e.name,
      overview: e.overview,
      stillPath: e.still_path,
      airDate: e.air_date,
      runtime: e.runtime,
      voteAverage: e.vote_average,
      voteCount: e.vote_count,
      productionCode: e.production_code,
      episodeType: e.episode_type ?? null,
    })),
  });

  const fresh = await getCachedSeason(seriesTmdbId, seasonNumber);

  logApiCall({
    api: "tmdb",
    op: "sync-season",
    mediaType: "tv",
    tmdbId: seriesTmdbId,
    endpoint: `/tv/${seriesTmdbId}/season/${seasonNumber}`,
    cacheStatus: options.force ? "forced" : "miss",
    durationMs: Date.now() - t0,
    success: true,
  });

  return {
    season: fresh,
    source: "tmdb",
    cache_status: options.force
      ? "force_refreshed"
      : cached
        ? "stale_refreshed"
        : "created",
  };
}

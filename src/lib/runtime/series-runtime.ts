import type { RuntimeResolution } from "./runtime-engine";
import { normalizeRuntimeMinutes } from "./runtime-utils";

export type EpisodeRuntimeInput = {
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  runtimeMinutes?: number | null;
  aired?: boolean;
  airDate?: string | null;
};

export type SeriesRuntimeStats = {
  averageRuntimeMinutes: number | null;
  source: RuntimeResolution["source"];
  estimated: boolean;
  sampleSize: number;
  minRuntimeMinutes: number | null;
  maxRuntimeMinutes: number | null;
  variableRuntime: boolean;
};

const VARIABLE_RUNTIME_THRESHOLD_MINUTES = 15;

function isAiredEpisode(episode: EpisodeRuntimeInput): boolean {
  if (episode.aired === true) return true;
  if (!episode.airDate) return false;
  const time = new Date(episode.airDate).getTime();
  if (!Number.isFinite(time)) return false;
  return time <= Date.now();
}

function shouldUseEpisodeForAverage(episode: EpisodeRuntimeInput): boolean {
  if (episode.seasonNumber === 0) return false;
  if (!isAiredEpisode(episode)) return false;
  return normalizeRuntimeMinutes(episode.runtimeMinutes) !== null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
}

function getMin(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.min(...values);
}

function getMax(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.max(...values);
}

/**
 * Calcula runtime médio de uma série usando cadeia completa de fallback.
 *
 * Cadeia de prioridade (da mais confiável para a menos):
 *   1. Média dos episódios reais com runtime em poplog3_episodes (source: "real")
 *   2. Primeiro valor de episode_run_time[] do TMDB (source: "tmdb_array", estimado)
 *   3. Fallback de runtimeMinutes global da série — campo `runtime` de poplog3_titles
 *      (source: "tmdb", estimado) — útil para séries antigas/obscuras sem dados por ep
 *   4. null — série sem nenhum dado de runtime disponível
 *
 * A diferença entre os níveis reflete confiança:
 *   - "real" = dados reais de episódios, não estimado
 *   - "tmdb_array" = array TMDB, razoavelmente confiável, estimado
 *   - "tmdb" = campo runtime único da série (às vezes é duração de 1 episódio,
 *              às vezes é 0, às vezes é total) — usar com cautela, estimado
 *
 * @param input.episodes         - episódios com runtime (de poplog3_episodes)
 * @param input.episodeRunTime   - array episode_run_time do TMDB
 * @param input.seriesRuntime    - campo runtime único da série (poplog3_titles.runtime)
 */
export function calculateSeriesRuntimeStats(input: {
  episodes?: EpisodeRuntimeInput[] | null;
  episodeRunTime?: number[] | null;
  /** Fallback: campo `runtime` da série no TMDB (pode ser minutos por episódio). */
  seriesRuntime?: number | null;
}): SeriesRuntimeStats {

  // ── Nível 1: episódios reais com runtime ──────────────────────────────────
  const realRuntimeValues =
    input.episodes
      ?.filter(shouldUseEpisodeForAverage)
      .map((episode) => normalizeRuntimeMinutes(episode.runtimeMinutes))
      .filter((value): value is number => value !== null) ?? [];

  if (realRuntimeValues.length > 0) {
    const minRuntimeMinutes = getMin(realRuntimeValues);
    const maxRuntimeMinutes = getMax(realRuntimeValues);

    return {
      averageRuntimeMinutes: average(realRuntimeValues),
      source: "real",
      estimated: false,
      sampleSize: realRuntimeValues.length,
      minRuntimeMinutes,
      maxRuntimeMinutes,
      variableRuntime:
        minRuntimeMinutes !== null &&
        maxRuntimeMinutes !== null &&
        maxRuntimeMinutes - minRuntimeMinutes > VARIABLE_RUNTIME_THRESHOLD_MINUTES,
    };
  }

  // ── Nível 2: episode_run_time[] do TMDB ───────────────────────────────────
  const tmdbArrayRuntime =
    input.episodeRunTime
      ?.map((value) => normalizeRuntimeMinutes(value))
      .find((value): value is number => value !== null) ?? null;

  if (tmdbArrayRuntime !== null) {
    return {
      averageRuntimeMinutes: tmdbArrayRuntime,
      source: "tmdb_array",
      estimated: true,
      sampleSize: 0,
      minRuntimeMinutes: null,
      maxRuntimeMinutes: null,
      variableRuntime: false,
    };
  }

  // ── Nível 3: campo `runtime` global da série (TMDB) ───────────────────────
  // Usado como estimativa quando não há dados por episódio.
  // Razoável para séries com episódios de duração uniforme (dramas, comedies).
  // Não confiável para reality shows ou séries com variação extrema de runtime.
  const seriesRuntimeFallback = normalizeRuntimeMinutes(input.seriesRuntime);

  if (seriesRuntimeFallback !== null) {
    return {
      averageRuntimeMinutes: seriesRuntimeFallback,
      source: "tmdb",
      estimated: true,
      sampleSize: 0,
      minRuntimeMinutes: null,
      maxRuntimeMinutes: null,
      variableRuntime: false,
    };
  }

  // ── Nível 4: sem dados disponíveis ────────────────────────────────────────
  return {
    averageRuntimeMinutes: null,
    source: null,
    estimated: false,
    sampleSize: 0,
    minRuntimeMinutes: null,
    maxRuntimeMinutes: null,
    variableRuntime: false,
  };
}

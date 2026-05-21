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

export function calculateSeriesRuntimeStats(input: {
  episodes?: EpisodeRuntimeInput[] | null;
  episodeRunTime?: number[] | null;
}): SeriesRuntimeStats {
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

import {
  formatEpisodeRuntimeLabel,
  formatRemainingRuntimeLabel,
  formatRuntimeLabel,
} from "@/lib/domain-labels";

import type { ProgressRuntimeStats } from "./progress-runtime";
import type { RuntimeResolution } from "./runtime-engine";
import type { SeriesRuntimeStats } from "./series-runtime";

export function formatRuntimeResolutionLabel(
  resolution: RuntimeResolution,
  options: {
    spaced?: boolean;
    fallback?: string | null;
  } = {}
): string | null {
  return formatRuntimeLabel(resolution.minutes, {
    estimated: resolution.estimated,
    spaced: options.spaced,
    fallback: options.fallback,
  });
}

export function formatSeriesAverageRuntimeLabel(
  stats: Pick<
    SeriesRuntimeStats,
    | "averageRuntimeMinutes"
    | "estimated"
    | "variableRuntime"
    | "minRuntimeMinutes"
    | "maxRuntimeMinutes"
  >,
  options: {
    fallback?: string | null;
  } = {}
): string | null {
  if (
    stats.variableRuntime &&
    stats.minRuntimeMinutes !== null &&
    stats.maxRuntimeMinutes !== null
  ) {
    const min = formatRuntimeLabel(stats.minRuntimeMinutes);
    const max = formatRuntimeLabel(stats.maxRuntimeMinutes);

    if (min && max) {
      return `entre ${min} e ${max}/ep`;
    }
  }

  return formatEpisodeRuntimeLabel(stats.averageRuntimeMinutes, {
    estimated: stats.estimated,
    fallback: options.fallback,
  });
}

export function formatProgressRuntimeLabels(
  stats: ProgressRuntimeStats
): {
  averageEpisodeRuntime: string | null;
  watchedRuntime: string | null;
  remainingRuntime: string | null;
  remainingSeasonRuntime: string | null;
} {
  return {
    averageEpisodeRuntime: formatEpisodeRuntimeLabel(
      stats.averageRuntimeMinutes,
      {
        estimated: stats.estimated,
      }
    ),
    watchedRuntime: formatRuntimeLabel(stats.totalWatchedMinutes, {
      estimated: stats.estimated,
    }),
    remainingRuntime: formatRemainingRuntimeLabel(stats.remainingMinutes, {
      estimated: stats.estimated,
    }),
    remainingSeasonRuntime: formatRemainingRuntimeLabel(
      stats.remainingSeasonMinutes,
      {
        estimated: stats.estimated,
      }
    ),
  };
}

export function formatEpisodesRemainingLabel(count: number): string | null {
  if (count <= 0) return null;

  return count === 1 ? "1 episódio restante" : `${count} episódios restantes`;
}

export function formatSeasonEpisodesRemainingLabel(count: number): string | null {
  if (count <= 0) return null;

  return count === 1
    ? "1 episódio restante na temporada"
    : `${count} episódios restantes na temporada`;
}
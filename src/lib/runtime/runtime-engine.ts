import { resolveMovieRuntime } from "./movie-runtime";
import { calculateSeriesRuntimeStats } from "./series-runtime";

export type RuntimeSource = "tmdb" | "real" | "tmdb_array" | "estimated";

export type RuntimeResolution = {
  minutes: number | null;
  source: RuntimeSource | null;
  estimated: boolean;
};

export function resolveRuntimeByMediaType(input: {
  mediaType: "movie" | "tv";
  runtimeMinutes?: number | null;
  episodeRunTime?: number[] | null;
  episodes?: Parameters<typeof calculateSeriesRuntimeStats>[0]["episodes"];
}): RuntimeResolution {
  if (input.mediaType === "movie") {
    return resolveMovieRuntime(input.runtimeMinutes);
  }

  const stats = calculateSeriesRuntimeStats({
    episodes: input.episodes,
    episodeRunTime: input.episodeRunTime,
  });

  return {
    minutes: stats.averageRuntimeMinutes,
    source: stats.source,
    estimated: stats.estimated,
  };
}

import { resolveMovieRuntime } from "./movie-runtime";
import { calculateSeriesRuntimeStats } from "./series-runtime";

export type RuntimeSource = "tmdb" | "real" | "tmdb_array" | "estimated";

export type RuntimeResolution = {
  minutes: number | null;
  source: RuntimeSource | null;
  estimated: boolean;
};

/**
 * Resolve o runtime de um título pelo media_type.
 *
 * Para séries TV, usa cadeia de fallback completa:
 *   1. Episódios reais com runtime (poplog3_episodes)
 *   2. episode_run_time[] do TMDB
 *   3. Campo runtime global da série (TMDB) — fallback de último recurso
 *   4. null
 *
 * @param input.mediaType        - "movie" | "tv"
 * @param input.runtimeMinutes   - runtime do título (filmes: duração total; TV: campo runtime)
 * @param input.episodeRunTime   - array episode_run_time do TMDB (TV only)
 * @param input.episodes         - episódios com runtime de poplog3_episodes (TV only)
 */
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
    // Nível 3 de fallback: campo runtime da série — pode ser duração por episódio
    // em séries onde TMDB não tem episode_run_time[] nem dados por ep.
    seriesRuntime: input.runtimeMinutes,
  });

  return {
    minutes: stats.averageRuntimeMinutes,
    source: stats.source,
    estimated: stats.estimated,
  };
}

import type { RuntimeResolution } from "./runtime-engine";
import {
  isReasonableMovieRuntime,
  normalizeRuntimeMinutes,
} from "./runtime-utils";

export function resolveMovieRuntime(
  runtimeMinutes?: number | null
): RuntimeResolution {
  const normalized = normalizeRuntimeMinutes(runtimeMinutes);

  if (normalized === null) {
    return {
      minutes: null,
      source: null,
      estimated: false,
    };
  }

  if (!isReasonableMovieRuntime(normalized)) {
    return {
      minutes: null,
      source: null,
      estimated: false,
    };
  }

  return {
    minutes: normalized,
    source: "tmdb",
    estimated: false,
  };
}
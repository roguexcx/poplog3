export const MIN_REASONABLE_RUNTIME = 1;
export const MAX_REASONABLE_MOVIE_RUNTIME = 600;

export function normalizeRuntimeMinutes(
  minutes?: number | null
): number | null {
  if (typeof minutes !== "number") return null;
  if (!Number.isFinite(minutes)) return null;

  const rounded = Math.round(minutes);

  if (rounded < MIN_REASONABLE_RUNTIME) return null;

  return rounded;
}

export function isReasonableMovieRuntime(minutes?: number | null): boolean {
  const normalized = normalizeRuntimeMinutes(minutes);

  return (
    normalized !== null &&
    normalized >= MIN_REASONABLE_RUNTIME &&
    normalized <= MAX_REASONABLE_MOVIE_RUNTIME
  );
}
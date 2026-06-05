/**
 * Synthetic tmdbId for titles that only have an IMDb ID (no real TMDB mapping).
 *
 * IMDb IDs are globally unique positive integers, so negating them gives a
 * collision-free range that can be stored in INT columns (MySQL INT range:
 * -2147483648 to 2147483647). Real TMDB IDs are always positive.
 *
 * Examples:
 *   "tt0137523" (Fight Club)  → -137523
 *   "tt1375666" (Inception)   → -1375666
 */

export function syntheticTmdbFromImdbId(imdbId: string): number | null {
  const match = /^tt(\d+)$/i.exec(imdbId.trim());
  if (!match) return null;
  const n = parseInt(match[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return -n;
}

export function isSyntheticTmdbId(tmdbId: number): boolean {
  return tmdbId < 0;
}

export function imdbIdFromSyntheticTmdbId(tmdbId: number): string | null {
  if (tmdbId >= 0) return null;
  return `tt${Math.abs(tmdbId)}`;
}

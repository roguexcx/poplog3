/**
 * Synthetic tmdbId for titles that only have an IMDb ID (no real TMDB mapping).
 *
 * IMDb IDs are globally unique positive integers, so negating them gives a
 * collision-free range that can be stored in INT columns (MySQL INT range:
 * -2147483648 to 2147483647). Real TMDB IDs are always positive.
 *
 * IMPORTANTE: IDs IMDb são zero-padded para no mínimo 7 dígitos ("tt0137523").
 * O número perde os zeros à esquerda ao virar synthetic, então a reconstrução
 * PRECISA re-aplicar o padding — caso contrário "tt0137523" → -137523 → "tt137523"
 * (inválido), quebrando identity/hidratação/página de título.
 *
 * Examples:
 *   "tt0137523" (Fight Club)  → -137523  → "tt0137523"
 *   "tt1375666" (Inception)   → -1375666 → "tt1375666"
 *   "tt10172266"              → -10172266 → "tt10172266"
 */

/** Largura mínima canônica de um ID IMDb (dígitos após "tt"). */
const IMDB_MIN_DIGITS = 7;

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
  // Re-aplica o zero-padding canônico (mín. 7 dígitos) perdido na conversão.
  return `tt${String(Math.abs(tmdbId)).padStart(IMDB_MIN_DIGITS, "0")}`;
}

// src/lib/images/config.ts

/**
 * Global switch for TMDB image randomization.
 *
 * When disabled, callers should keep the default TMDB poster_path/backdrop_path
 * and skip extra calls to the /images endpoint.
 */
export const RANDOMIZATION_ENABLED = true;

/**
 * Cache TTL for TMDB /images responses.
 */
export const IMAGES_CACHE_SECONDS = 60 * 60 * 24;

/**
 * Default poster rotation: English, Portuguese and textless images have the
 * same draw weight.
 */
export const POSTER_RANDOMIZATION_LANGUAGES: readonly (string | null)[] = [
  "en",
  "pt",
  null,
];

/**
 * Poster rotation for browse/search surfaces where text-bearing posters are ok,
 * but only in English or Portuguese.
 */
export const LOCALIZED_POSTER_RANDOMIZATION_LANGUAGES: readonly (string | null)[] = [
  "en",
  "pt",
];

/**
 * Default backdrop/background rotation: only textless images.
 */
export const BACKDROP_RANDOMIZATION_LANGUAGES: readonly (string | null)[] = [
  null,
];

/**
 * Backward-compatible alias for poster-like image pools.
 */
export const RANDOMIZATION_LANGUAGES = POSTER_RANDOMIZATION_LANGUAGES;

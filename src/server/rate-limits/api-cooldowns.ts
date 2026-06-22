export const API_COOLDOWNS = {
  tmdb: {
    minIntervalMs: 250,
  },

  omdb: {
    minIntervalMs: 1000,
  },

  watchmode: {
    minIntervalMs: 4000,
  },

  movieofthenight: {
    minIntervalMs: 6000,
  },
} as const;
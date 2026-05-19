export const CACHE_TTL = {
  tmdb: {
    trending: 60 * 60 * 6,
    discover: 60 * 60 * 24,
    discoverCalendar: 60 * 60 * 6,
    discoverProvider: 60 * 60,
    agendaPriority: 60 * 30,
    details: 60 * 60 * 24 * 30,
  },

  omdb: {
    ratings: 60 * 60 * 24 * 30,
  },

  watchmode: {
    availability: 60 * 60 * 24 * 7,
  },

  movieofthenight: {
    availability: 60 * 60 * 24 * 14,
    events: 60 * 60 * 24 * 14,
  },
} as const;

export type PoplogTitle = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  poplogId?: string | number | null;
  externalIds?: {
    tmdbId?: number;
    imdbId?: string;
    tvdbId?: number;
    traktId?: number | string;
    balloonerismmId?: string;
    slug?: string;
  };
  identityUsed?: string;
  linkIdUsed?: string | number;
  hasPoplogId?: boolean;
  normalizedFrom?: string;
  legacyCompatibilityUsed?: boolean;

  title: string;
  original_title?: string | null;

  overview?: string | null;

  poster_path?: string | null;
  backdrop_path?: string | null;

  release_date?: string | null;
  first_air_date?: string | null;
  last_air_date?: string | null;
  year?: number | null;

  runtime?: number | null;
  episode_run_time?: number[] | null;

  genres?: number[];

  popularity?: number | null;
  vote_average?: number | null;
  vote_count?: number | null;

  original_language?: string | null;

  imdb_id?: string | null;

  /** Timestamp de quando o registro foi sincronizado no cache. */
  last_synced_at?: string | null;
};

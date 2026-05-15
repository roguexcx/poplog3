export type PoplogEpisode = {
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
  tmdb_episode_id: number | null;
  name: string | null;
  overview: string | null;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
  vote_average: number | null;
  vote_count: number | null;
  production_code: string | null;
  episode_type: string | null;
};

export type PoplogSeason = {
  series_tmdb_id: number;
  season_number: number;
  tmdb_season_id: number | null;
  name: string | null;
  overview: string | null;
  poster_path: string | null;
  air_date: string | null;
  episode_count: number | null;
  vote_average: number | null;
  last_synced_at: string | null;
  episodes: PoplogEpisode[];
};

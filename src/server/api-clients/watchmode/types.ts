export type WatchmodeSource = {
  source_id?: number;
  name?: string;
  type?: string;
  region?: string;
  web_url?: string;
  ios_url?: string;
  android_url?: string;
  format?: string;
  price?: number;
  seasons?: number;
  episodes?: number;
};

export type WatchmodeTitleResponse = {
  id?: number;
  title?: string;
  original_title?: string;
  plot_overview?: string;
  type?: string;
  year?: number;
  end_year?: number;
  release_date?: string;
  imdb_id?: string;
  tmdb_id?: number;
  tmdb_type?: "movie" | "tv";
  genre_names?: string[];
  user_rating?: number;
  critic_score?: number;
  us_rating?: string;
  runtime_minutes?: number;
  poster?: string;
  backdrop?: string;
  sources?: WatchmodeSource[];
};
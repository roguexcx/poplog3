export type TmdbMediaType = "movie" | "tv";

export type TmdbProductionCompany = {
  id: number;
  name: string;
  logo_path?: string | null;
  origin_country?: string | null;
};

export type TmdbProductionCountry = {
  iso_3166_1: string;
  name: string;
};

export type TmdbSpokenLanguage = {
  iso_639_1: string;
  english_name?: string;
  name?: string;
};

export type TmdbNetwork = {
  id: number;
  name: string;
  logo_path?: string | null;
  origin_country?: string | null;
};

export type TmdbCollectionSummary = {
  id: number;
  name: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
};

export type TmdbCollectionPart = {
  id: number;
  title?: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  media_type?: string;
};

export type TmdbCollectionDetails = {
  id: number;
  name: string;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  parts: TmdbCollectionPart[];
};

export type TmdbCreator = {
  id: number;
  name: string;
  profile_path?: string | null;
};

export type TmdbTitleSummary = {
  id: number;
  media_type?: TmdbMediaType;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  last_air_date?: string | null;
  genre_ids?: number[];
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  original_language?: string;

  /** Campos extras surfaceados quando vem de /movie/{id} ou /tv/{id}. */
  runtime?: number | null;
  episode_run_time?: number[] | null;

  imdb_id?: string | null;
  homepage?: string | null;
  status?: string | null;
  tagline?: string | null;

  // Movies
  budget?: number | null;
  revenue?: number | null;
  belongs_to_collection?: TmdbCollectionSummary | null;

  // Series
  number_of_seasons?: number | null;
  number_of_episodes?: number | null;
  networks?: TmdbNetwork[];
  created_by?: TmdbCreator[];
  type?: string | null;
  in_production?: boolean | null;

  production_companies?: TmdbProductionCompany[];
  production_countries?: TmdbProductionCountry[];
  spoken_languages?: TmdbSpokenLanguage[];
};

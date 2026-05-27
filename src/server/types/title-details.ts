import { PoplogTitle } from "./title";

export type PoplogTitleCastMember = {
  id: number;
  name: string;
  character?: string | null;
  profile_path?: string | null;
};

export type PoplogTitleCrewMember = {
  id: number;
  name: string;
  job: string;
  department?: string | null;
  profile_path?: string | null;
};

export type PoplogTitleVideo = {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official?: boolean | null;
  iso_639_1?: string | null;
};

export type PoplogTitleGenre = {
  id: number;
  name: string;
};

export type PoplogTitleRecommendation = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  name: string;
  original_title?: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number | null;
  release_date: string | null;
  first_air_date: string | null;
};

export type PoplogTitleEpisodeStub = {
  air_date?: string | null;
  episode_number?: number | null;
  season_number?: number | null;
  name?: string | null;
};

export type PoplogTitleCompany = {
  id: number;
  name: string;
  logo_path?: string | null;
  origin_country?: string | null;
};

export type PoplogTitleCountry = {
  iso_3166_1: string;
  name: string;
};

export type PoplogTitleLanguage = {
  iso_639_1: string;
  name: string;
  english_name?: string | null;
};

export type PoplogTitleCollection = {
  id: number;
  name: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
};

export type PoplogTitleNetwork = {
  id: number;
  name: string;
  logo_path?: string | null;
  origin_country?: string | null;
};

export type PoplogTitleCreator = {
  id: number;
  name: string;
  profile_path?: string | null;
};

export type PoplogTitleSeasonStub = {
  season_number: number;
  name: string | null;
  overview: string | null;
  poster_path: string | null;
  air_date: string | null;
  episode_count: number | null;
  vote_average: number | null;
};

export type PoplogTitleDetails = Omit<PoplogTitle, "genres"> & {
  runtime?: number | null;

  tagline?: string | null;

  status?: string | null;

  genres?: PoplogTitleGenre[];

  cast?: PoplogTitleCastMember[];
  crew?: PoplogTitleCrewMember[];

  videos?: PoplogTitleVideo[];

  recommendations?: PoplogTitleRecommendation[];
  similar?: PoplogTitleRecommendation[];

  first_air_date?: string | null;
  last_air_date?: string | null;
  number_of_seasons?: number | null;
  number_of_episodes?: number | null;
  next_episode_to_air?: PoplogTitleEpisodeStub | null;
  last_episode_to_air?: PoplogTitleEpisodeStub | null;

  /** Lista bruta de temporadas vinda do TMDB. */
  seasons?: PoplogTitleSeasonStub[];

  production_companies?: PoplogTitleCompany[];
  production_countries?: PoplogTitleCountry[];
  spoken_languages?: PoplogTitleLanguage[];
  homepage?: string | null;

  budget?: number | null;
  revenue?: number | null;
  belongs_to_collection?: PoplogTitleCollection | null;

  networks?: PoplogTitleNetwork[];
  created_by?: PoplogTitleCreator[];
  type?: string | null;
  in_production?: boolean | null;
};

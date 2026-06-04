/**
 * Tipos da API Balloonerismm.
 *
 * Balloonerismm é uma API IMDb-first não oficial.
 * Confiança de conteúdo: alta quando IMDb ID confirmado.
 * Prioridade operacional: controlada (não é primeira fonte global).
 */

export type BalloonerismIds = {
  imdb?: string;
  tmdb?: number; // presente em alguns endpoints, não usar como chave operacional
  tvdb?: number;
};

export type BalloonerismImages = {
  poster?: string | null;
  backdrop?: string | null;
  logo?: string | null;
};

export type BalloonerismMovie = {
  imdb_id: string;
  title: string;
  year?: number | null;
  overview?: string | null;
  tagline?: string | null;
  runtime?: number | null;
  status?: string | null;
  genres?: string[] | null;
  country?: string | null;
  language?: string | null;
  certification?: string | null;
  rating?: number | null;
  votes?: number | null;
  ids?: BalloonerismIds;
  images?: BalloonerismImages;
  awards?: BalloonerismAward[] | null;
  trivia?: string[] | null;
  quotes?: string[] | null;
  soundtrack?: BalloonerismSoundtrackItem[] | null;
  technical_specs?: Record<string, string> | null;
  taglines?: string[] | null;
  trailers?: BalloonerismVideo[] | null;
  reviews?: BalloonerismReview[] | null;
  parental_guide?: BalloonerismParentalGuide | null;
  providers?: BalloonerismProvider[] | null;
};

export type BalloonerismShow = {
  imdb_id: string;
  title: string;
  year?: number | null;
  overview?: string | null;
  tagline?: string | null;
  runtime?: number | null;
  status?: string | null;
  genres?: string[] | null;
  country?: string | null;
  language?: string | null;
  certification?: string | null;
  rating?: number | null;
  votes?: number | null;
  ids?: BalloonerismIds;
  images?: BalloonerismImages;
  trailers?: BalloonerismVideo[] | null;
  reviews?: BalloonerismReview[] | null;
  providers?: BalloonerismProvider[] | null;
};

export type BalloonerismSearchResult = {
  imdb_id: string;
  media_type: "movie" | "show";
  title: string;
  year?: number | null;
  overview?: string | null;
  images?: BalloonerismImages;
};

export type BalloonerismPopularItem = {
  imdb_id: string;
  media_type: "movie" | "show";
  title: string;
  year?: number | null;
  overview?: string | null;
  images?: BalloonerismImages;
  rank?: number;
};

export type BalloonerismAward = {
  event?: string;
  category?: string;
  year?: number;
  won?: boolean;
};

export type BalloonerismSoundtrackItem = {
  title?: string;
  artist?: string;
};

export type BalloonerismVideo = {
  url: string;
  name?: string;
  type?: "trailer" | "teaser" | "clip" | "featurette" | "behind_the_scenes" | string;
};

export type BalloonerismReview = {
  author?: string;
  rating?: number;
  content?: string;
  date?: string;
  source?: string;
};

export type BalloonerismParentalGuide = {
  rating?: string;
  advisories?: Record<string, string>;
};

export type BalloonerismProvider = {
  name: string;
  type: "subscription" | "rent" | "buy" | "free" | string;
  logo_url?: string;
  region?: string;
  url?: string;
};

export type BalloonerismPerson = {
  imdb_id?: string;
  name: string;
  biography?: string | null;
  birthdate?: string | null;
  birthplace?: string | null;
  images?: { headshot?: string | null };
};

export type BalloonerismCastMember = {
  person: BalloonerismPerson;
  character?: string;
  order?: number;
};

export type BalloonerismCrewMember = {
  person: BalloonerismPerson;
  job?: string;
  department?: string;
};

export type BalloonerismPeopleResponse = {
  cast?: BalloonerismCastMember[];
  crew?: {
    directing?: BalloonerismCrewMember[];
    writing?: BalloonerismCrewMember[];
    production?: BalloonerismCrewMember[];
    [dept: string]: BalloonerismCrewMember[] | undefined;
  };
};

export type BalloonerismCreditPerson = {
  id?: string;
  imdb_id?: string;
  name: string;
  character?: string;
  job?: string;
  department?: string;
  order?: number;
  profile_path?: string | null;
};

export type BalloonerismCreditsResponse = {
  id?: string;
  cast?: BalloonerismCreditPerson[];
  crew?: BalloonerismCreditPerson[];
};

export type BalloonerismExternalIds = {
  imdb_id?: string | null;
  tmdb_id?: number | null;
  tvdb_id?: number | null;
  wikidata_id?: string | null;
  facebook_id?: string | null;
  instagram_id?: string | null;
  twitter_id?: string | null;
};

export type BalloonerismPersonDetails = {
  imdb_id?: string;
  name: string;
  biography?: string | null;
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string | null;
  profile_path?: string | null;
  known_for_department?: string | null;
};

export type BalloonerismPersonCreditItem = {
  imdb_id?: string;
  title?: string;
  name?: string;
  media_type?: "movie" | "tv";
  character?: string;
  job?: string;
  department?: string;
  year?: number | null;
  images?: BalloonerismImages;
};

export type BalloonerismPersonCombinedCredits = {
  cast?: BalloonerismPersonCreditItem[];
  crew?: BalloonerismPersonCreditItem[];
};

export type BalloonerismGenreItem = {
  id: number;
  name: string;
};

export type BalloonerismGenreList = {
  genres: BalloonerismGenreItem[];
};

export type BalloonerismFetchOptions = {
  params?: Record<string, string | number | boolean>;
  cache?: RequestCache;
  signal?: AbortSignal;
  /** TTL override em segundos (sobrescreve default do cliente) */
  ttlSeconds?: number;
};

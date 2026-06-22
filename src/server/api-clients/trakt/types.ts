/**
 * Tipos de resposta da API Trakt.tv v2.
 * Referência: https://trakt.docs.apiary.io/
 */

export type TraktFetchOptions = {
  params?: Record<string, string | number | boolean>;
  ttlSeconds?: number;
  cache?: RequestCache;
  signal?: AbortSignal;
  staleTtlSeconds?: number;
};

export type TraktRequestOptions = TraktFetchOptions & {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  accessToken?: string | null;
};

/** IDs externos retornados em objetos Trakt. */
export type TraktIds = {
  trakt?: number;
  slug?: string;
  imdb?: string;
  tmdb?: number;
  tvdb?: number;
  tvrage?: number;
};

/** Resposta de /shows/{id}/seasons (sem extended=full) */
export type TraktSeasonSummary = {
  number: number;
  ids: {
    trakt: number;
    tvdb?: number;
    tmdb?: number;
  };
};

/** Resposta de /shows/{id}/seasons?extended=full */
export type TraktSeasonFull = TraktSeasonSummary & {
  title?: string;
  overview?: string | null;
  first_aired?: string | null;
  episode_count?: number;
  aired_episodes?: number;
  rating?: number;
  votes?: number;
  network?: string;
  images?: {
    poster?: string[];
    thumb?: string[];
    fanart?: string[];
  } | null;
};

/** Episódio em /shows/{id}/seasons/{season}/episodes?extended=full,translations */
export type TraktEpisodeFull = {
  season: number;
  number: number;
  title?: string | null;
  ids: {
    trakt: number;
    tvdb?: number;
    tmdb?: number;
    imdb?: string;
  };
  overview?: string | null;
  first_aired?: string | null;
  updated_at?: string;
  rating?: number;
  votes?: number;
  runtime?: number | null;
  /** Tipo do episódio: standard, series_premiere, season_premiere, mid_season_finale, mid_season_premiere, season_finale, series_finale */
  episode_type?: string | null;
  images?: {
    screenshot?: string[];
    thumb?: string[];
    fanart?: string[];
  } | null;
  translations?: TraktTranslation[] | null;
};

/** Resposta de /shows/{id}/people?extended=full */
export type TraktPeople = {
  cast?: TraktPersonEntry[];
  crew?: {
    directing?: TraktPersonEntry[];
    writing?: TraktPersonEntry[];
    production?: TraktPersonEntry[];
    editing?: TraktPersonEntry[];
    camera?: TraktPersonEntry[];
    sound?: TraktPersonEntry[];
    art?: TraktPersonEntry[];
    costume_make_up?: TraktPersonEntry[];
    visual_effects?: TraktPersonEntry[];
    crew?: TraktPersonEntry[];
    [key: string]: TraktPersonEntry[] | undefined;
  };
};

export type TraktPersonEntry = {
  characters?: string[];
  character?: string;
  jobs?: string[];
  job?: string;
  episode_count?: number;
  person: {
    name: string;
    ids: {
      trakt?: number;
      slug?: string;
      imdb?: string;
      tmdb?: number;
    };
    images?: {
      headshot?: string[];
    } | null;
  };
};

/** Resposta de /shows/{id}/videos */
export type TraktVideoItem = {
  name: string;
  key: string;
  site: string;
  type: string;
  quality?: string;
  language?: string;
  thumbnail?: string;
};

/** Resposta de /shows/{id}/studios */
export type TraktStudio = {
  name: string;
  country?: string;
  ids?: {
    trakt?: number;
    slug?: string;
    tmdb?: number;
  };
};

/** Resposta de /shows/{id}/certifications */
export type TraktCertifications = {
  us?: string;
  [country: string]: string | undefined;
};

/** Resposta de /shows/{id}/next-episode ou /shows/{id}/last-episode */
export type TraktEpisodeSummary = {
  season: number;
  number: number;
  title?: string | null;
  ids: {
    trakt: number;
    tvdb?: number;
    tmdb?: number;
    imdb?: string;
  };
  overview?: string | null;
  first_aired?: string | null;
  runtime?: number | null;
  episode_type?: string | null;
  rating?: number;
  votes?: number;
};

/** Resposta de /shows/{id} extended=full */
export type TraktShowFull = {
  title: string;
  year?: number;
  ids: TraktIds;
  overview?: string | null;
  first_aired?: string | null;
  airs?: {
    day?: string;
    time?: string;
    timezone?: string;
  };
  runtime?: number | null;
  certification?: string;
  network?: string;
  country?: string;
  status?: string;
  rating?: number;
  votes?: number;
  aired_episodes?: number;
  language?: string;
  genres?: string[];
  aired_seasons?: number;
  trailer?: string | null;
  homepage?: string | null;
  tagline?: string | null;
  available_translations?: string[];
  translations?: TraktTranslation[] | null;
  images?: {
    poster?: string[];
    fanart?: string[];
    logo?: string[];
    thumb?: string[];
    clearart?: string[];
    banner?: string[];
  } | null;
};

export type TraktImages = {
  poster?: string[] | null;
  fanart?: string[] | null;
  logo?: string[] | null;
  thumb?: string[] | null;
  clearart?: string[] | null;
  banner?: string[] | null;
} | null;

/** Resposta de /movies/{id} extended=full */
export type TraktMovieFull = {
  title: string;
  year?: number;
  ids: TraktIds;
  tagline?: string | null;
  overview?: string | null;
  released?: string | null;
  runtime?: number | null;
  country?: string;
  rating?: number;
  votes?: number;
  status?: string;
  language?: string;
  genres?: string[];
  certification?: string;
  trailer?: string | null;
  homepage?: string | null;
  translations?: TraktTranslation[] | null;
  images?: TraktImages;
};

/** Trending item wrapper */
export type TraktTrendingItem<T> = {
  watchers: number;
  show?: T;
  movie?: T;
};

/** Popular/search result */
export type TraktSearchResult = {
  type: "movie" | "show";
  score?: number;
  show?: TraktShowFull;
  movie?: TraktMovieFull;
};

/** Entrada retornada por GET /networks */
export type TraktNetwork = {
  name: string;
  country?: string;
  ids?: {
    trakt?: number;
    slug?: string;
  };
};

/** Item from /movies/{id}/translations/{lang} or /shows/{id}/translations/{lang} */
export type TraktTranslation = {
  title: string;
  overview: string;
  tagline?: string;
  language: string;
  country: string;
};

/**
 * Tipos da API TheTVDB v4.
 *
 * TheTVDB é fonte especialista em séries, temporadas, episódios,
 * ordens alternativas, status de produção e datas futuras.
 *
 * Auth: JWT via /login — expira em 30 dias, renovar via token refresh.
 * Rate limit: 250 req/mês no plano gratuito, muito maior nos pagos.
 */

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type TvdbLoginResponse = {
  status: string;
  data: {
    token: string;
  };
};

// ─── IDs ──────────────────────────────────────────────────────────────────────

export type TvdbRemoteId = {
  id: string;
  type: number; // 2 = IMDB, 5 = TMDB, etc.
  sourceName: string;
};

// ─── Images ───────────────────────────────────────────────────────────────────

export type TvdbArtwork = {
  id: number;
  image: string;
  thumbnail?: string;
  language?: string | null;
  type: number; // 1=banner, 2=poster, 3=background, 22=logo, etc.
  width?: number;
  height?: number;
  score?: number;
};

// ─── Series ───────────────────────────────────────────────────────────────────

export type TvdbSeries = {
  id: number;
  name: string;
  slug?: string;
  image?: string | null;
  firstAired?: string | null;
  lastAired?: string | null;
  nextAired?: string | null;
  score?: number;
  status?: TvdbSeriesStatus;
  originalCountry?: string;
  originalLanguage?: string;
  overview?: string | null;
  overviewTranslations?: string[];
  genres?: TvdbGenre[];
  tags?: TvdbTag[];
  networks?: TvdbNetwork[];
  runtime?: number | null;
  seasons?: TvdbSeason[];
  averageRuntime?: number | null;
  year?: string | null;
  remoteIds?: TvdbRemoteId[];
  artworks?: TvdbArtwork[];
};

export type TvdbSeriesExtended = TvdbSeries & {
  trailers?: TvdbTrailer[];
  companies?: TvdbCompany[];
  characters?: TvdbCharacter[];
  lists?: TvdbList[];
  contentRatings?: TvdbContentRating[];
  seasonTypes?: TvdbSeasonType[];
};

export type TvdbSeriesStatus = {
  id: number;
  name: string; // "Continuing", "Ended", "Upcoming", "Pilot Ordered"
  recordType?: string;
  keepUpdated?: boolean;
};

// ─── Seasons ─────────────────────────────────────────────────────────────────

export type TvdbSeason = {
  id: number;
  seriesId: number;
  type?: TvdbSeasonType;
  name?: string | null;
  number: number;
  nameTranslations?: string[];
  overviewTranslations?: string[];
  image?: string | null;
  imageType?: number;
  lastUpdated?: string;
  year?: string | null;
};

export type TvdbSeasonExtended = TvdbSeason & {
  artwork?: TvdbArtwork[];
  companies?: TvdbCompany[];
  episodes?: TvdbEpisode[];
  trailers?: TvdbTrailer[];
};

export type TvdbSeasonType = {
  id: number;
  name: string; // "Aired Order", "DVD Order", "Absolute Order", etc.
  type: string; // "official", "dvd", "absolute", "alternate", "streaming", "regional"
  alternateName?: string | null;
};

// ─── Episodes ─────────────────────────────────────────────────────────────────

export type TvdbEpisode = {
  id: number;
  seriesId?: number;
  name?: string | null;
  aired?: string | null;
  runtime?: number | null;
  overview?: string | null;
  image?: string | null;
  thumbnail?: string | null;
  artwork?: TvdbArtwork[] | null;
  artworks?: TvdbArtwork[] | null;
  imageType?: number;
  isMovie?: number;
  seasons?: TvdbSeason[];
  number?: number;
  seasonNumber?: number;
  absoluteNumber?: number | null;
  airedOrder?: number | null;
  lastUpdated?: string;
  finaleType?: string | null;
  year?: string | null;
  remoteIds?: TvdbRemoteId[];
};

export type TvdbSeriesEpisodesResponse = {
  status: string;
  data: {
    series?: TvdbSeries;
    episodes?: TvdbEpisode[];
  };
};

// ─── Movies ───────────────────────────────────────────────────────────────────

export type TvdbMovie = {
  id: number;
  name: string;
  slug?: string;
  image?: string | null;
  score?: number;
  runtime?: number | null;
  status?: TvdbMovieStatus;
  studios?: TvdbCompany[];
  originalCountry?: string;
  originalLanguage?: string;
  firstRelease?: { date?: string; country?: string; detail?: string };
  releases?: Array<{ date?: string; country?: string; detail?: string }>;
  artworks?: TvdbArtwork[];
  overviewTranslations?: string[];
  nameTranslations?: string[];
  remoteIds?: TvdbRemoteId[];
  genres?: TvdbGenre[];
};

export type TvdbMovieStatus = {
  id: number;
  name: string;
};

// ─── People ───────────────────────────────────────────────────────────────────

export type TvdbPerson = {
  id: number;
  name: string;
  image?: string | null;
  score?: number;
  remoteIds?: TvdbRemoteId[];
  biography?: string | null;
  birthDate?: string | null;
  birthPlace?: string | null;
};

export type TvdbCharacter = {
  id: number;
  name?: string | null;
  peopleName?: string | null;
  seriesId?: number;
  series?: TvdbSeries;
  movieId?: number;
  movie?: TvdbMovie;
  peopleId?: number;
  personImgURL?: string | null;
  isFeatured?: boolean;
  url?: string;
  image?: string | null;
  episodeId?: number;
  type?: number;
  sort?: number;
  tagOptions?: TvdbTag[];
};

// ─── Misc ──────────────────────────────────────────────────────────────────────

export type TvdbGenre = {
  id: number;
  name: string;
  slug: string;
};

export type TvdbTag = {
  id: number;
  tag?: number;
  tagName?: string;
  name?: string | null;
  helpText?: string | null;
};

export type TvdbNetwork = {
  id: number;
  name: string;
  slug?: string;
  abbreviation?: string;
  country?: string;
};

export type TvdbCompany = {
  id: number;
  name: string;
  slug?: string;
  nameTranslations?: string[];
  overviewTranslations?: string[];
  primaryCompanyType?: number;
  activeDate?: string | null;
  inactiveDate?: string | null;
};

export type TvdbTrailer = {
  id: number;
  name?: string;
  url: string;
  runtime?: number;
  language?: string;
};

export type TvdbList = {
  id: number;
  name: string;
  overview?: string;
  url?: string;
  isOfficial?: boolean;
};

export type TvdbContentRating = {
  id: number;
  name: string;
  country?: string;
  description?: string;
  contentType?: string;
  order?: number;
  fullName?: string;
};

/** Response padrão envelope da API TVDB v4 */
export type TvdbResponse<T> = {
  status: string;
  data: T;
};

export type TvdbFetchOptions = {
  params?: Record<string, string | number | boolean>;
  cache?: RequestCache;
  signal?: AbortSignal;
  ttlSeconds?: number;
};

/**
 * Pagination envelope returned by TVDB v4 list endpoints (episodes, etc.).
 * `next` is a full URL to the next page; null when on the last page.
 */
export type TvdbLinks = {
  prev?: string | null;
  self?: string | null;
  next?: string | null;
  total_items?: number;
  page_size?: number;
};

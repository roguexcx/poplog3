import type { TitleAvailabilityState } from "@/lib/series";

export type TitleMediaType = "movie" | "tv";

export type TitleProviderType =
  | "streaming"
  | "rent"
  | "buy"
  | "free"
  | "ads";

export type TitleProviderSource = "tmdb" | "watchmode" | "motn";

export type TitleProvider = {
  name: string;
  logoUrl: string | null;
  type: TitleProviderType;
  providerId?: number | string | null;
  tmdbProviderId?: number | string | null;
  providerName?: string | null;
  logoPath?: string | null;
  deepLink?: string | null;
  deeplink?: string | null;
  quality?: string | null;
  country?: string;
  source?: TitleProviderSource | string;
  normalizedType?: "subscription" | "rent" | "buy" | "free" | "ads";
  confidence?: string;
  priorityScore?: number;
  isPreferred?: boolean;
};

export type TitleAvailabilityWindowStatus =
  | "no_data"
  | "unavailable"
  | "cinema"
  | "digital_prediction"
  | "pvod_available_us"
  | "vod_available_us"
  | "vod_available_br"
  | "streaming_confirmed_us"
  | "streaming_confirmed_br"
  | "partial"
  | "regional";

export type TitleAvailabilityRegion = {
  region: "BR" | "US";
  providers: TitleProvider[];
  primaryProvider: TitleProvider | null;
  subscriptionProviders: TitleProvider[];
  vodProviders: TitleProvider[];
  hasSubscription: boolean;
  hasVod: boolean;
  source: string;
  lastSyncedAt: string | null;
};

export type TitleAvailability = {
  tmdbId: number;
  mediaType: TitleMediaType;
  primaryRegion: "BR";
  radarRegion: "US";
  status: TitleAvailabilityWindowStatus;
  offerType:
    | "subscription"
    | "rent"
    | "buy"
    | "free"
    | "ads"
    | "pvod"
    | "cinema"
    | "none"
    | "unknown";
  primaryProvider: TitleProvider | null;
  regions: {
    BR: TitleAvailabilityRegion;
    US: TitleAvailabilityRegion;
  };
  isFallback: boolean;
  fallbackSource: "watchmode" | "movieofthenight" | null;
  confidence: string;
  refreshedAt: string;
  nextRefreshAfterDays: number;
  explanation: string;
};

export type TitleCastMember = {
  id: number | string;
  name: string;
  character?: string | null;
  photoUrl?: string | null;
};

export type TitleCrewMember = {
  id: number | string;
  name: string;
  job: string;
  department?: string | null;
  photoUrl?: string | null;
};

export type TitleRecommendation = {
  id: number | string;
  mediaType: TitleMediaType;
  title: string;
  year?: string | number | null;
  posterPath?: string | null;
  posterUrl?: string | null;
};

export type TitleTrailer = {
  key: string;
  name: string;
  url: string;
  embedUrl: string;
};

export type TitleEpisodeStub = {
  air_date?: string | null;
  episode_number?: number | null;
  season_number?: number | null;
  name?: string | null;
  episode_type?: string | null;
};

export type TitleSeasonInfo = {
  seasonNumber: number;
  name: string | null;
  airDate: string | null;
  episodeCount: number | null;
};

export type TitleRatings = {
  imdbRating?: number | null;
  imdbVotes?: number | null;
  rottenTomatoesScore?: number | null;
  metacriticScore?: number | null;
  tmdbRating?: number | null;
  poplogScore?: number | null;
  poplogComponents?: number;
};

export type TitleUserState = {
  status?: string | null;
  rating?: number | null;
  watched?: boolean;
  watching?: boolean;
  inWatchlist?: boolean;
  favorite?: boolean;
  liked?: boolean;
  disliked?: boolean;
  isAuthenticated?: boolean;
  /** Estado computado global — fonte de verdade para exibição de status visual. */
  computedState?: string | null;
};

export type TitleCompany = {
  id: number;
  name: string;
  logoPath?: string | null;
  originCountry?: string | null;
};

export type TitleNetwork = TitleCompany;

export type TitleCountry = {
  code: string;
  name: string;
};

export type TitleLanguage = {
  code: string;
  name: string;
};

export type TitleCollectionPart = {
  id: number;
  title: string;
  releaseDate?: string | null;
  year?: number | null;
  posterPath?: string | null;
};

export type TitleCollection = {
  id: number;
  name: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  parts?: TitleCollectionPart[];
};

export type TitleMetadataBlock = {
  productionCompanies?: TitleCompany[];
  productionCountries?: TitleCountry[];
  spokenLanguages?: TitleLanguage[];
  homepage?: string | null;
  budget?: number | null;
  revenue?: number | null;
  collection?: TitleCollection | null;
  networks?: TitleNetwork[];
  episodeRunTimeMinutes?: number | null;
  episodeRunTimeEstimated?: boolean;
  totalRuntimeMinutes?: number | null;
  totalRuntimeEstimated?: boolean;
  productionStatus?: string | null;
  inProduction?: boolean | null;
  seriesType?: string | null;

  creators?: string[];
  directors?: string[];
  writers?: string[];
  showrunners?: string[];
  composers?: string[];
};

export type TitleAvailabilityCache = {
  source: string;
  tmdb: string;
  watchmode: string;
  motn: string;
};

export type TitleCacheInfo = {
  title?: { source: string; status: string } | null;
  ratings?: { source: string; status: string } | null;
  availability?: TitleAvailabilityCache | null;
};

/** Progresso pessoal da serie para o usuario logado. */
export type TitleSeriesProgress = {
  watchedCount: number;
  /** Total planejado pelo TMDB — pode incluir episódios futuros. Usar airedEpisodes para progresso. */
  totalEpisodes: number | null;
  /** Episódios que já foram ao ar — denominador correto para barra de progresso. */
  airedEpisodes?: number;
  lastWatchedAt: string | null;
  /** Chaves "S##E##" — convenção da lib episode-progress-service. */
  watchedKeys: string[];
  nextEpisode: {
    seasonNumber: number;
    episodeNumber: number;
  } | null;
};

export type TitlePageData = {
  id: number | string;
  mediaType: TitleMediaType;
  title: string;
  originalTitle?: string | null;
  tagline?: string | null;
  year?: string | number | null;
  releaseDate?: string | null;
  firstAirDate?: string | null;
  lastAirDate?: string | null;
  numberOfSeasons?: number | null;
  numberOfEpisodes?: number | null;
  overview?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  runtime?: number | null;
  episodeRunTimeMinutes?: number | null;
  runtimeEstimated?: boolean;
  totalRuntimeMinutes?: number | null;
  totalRuntimeEstimated?: boolean;
  voteAverage?: number | null;
  genres?: string[];
  status?: string | null;
  availabilityState?: TitleAvailabilityState;
  certification?: string | null;
  trailer?: TitleTrailer | null;
  nextEpisode?: TitleEpisodeStub | null;
  seasons?: TitleSeasonInfo[];
  ratings?: TitleRatings | null;
  userState?: TitleUserState;
  /** Apenas para series, quando o usuario esta logado. */
  userSeriesProgress?: TitleSeriesProgress | null;
  providers?: TitleProvider[];
  availability?: TitleAvailability;
  country?: string;
  cast?: TitleCastMember[];
  crew?: TitleCrewMember[];
  recommendations?: TitleRecommendation[];
  metadata?: TitleMetadataBlock | null;
  lastSyncedAt?: string | null;
  cacheInfo?: TitleCacheInfo | null;
};

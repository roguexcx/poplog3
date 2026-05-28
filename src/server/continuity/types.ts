export type ContinuityMediaType = "movie" | "tv";

export type ContinuityContext =
  | "continue"
  | "new_episode"
  | "finish_season"
  | "resume"
  | "new_streaming"
  | "vod"
  | "watchlist"
  | "binge"
  | "rediscovery";

export type ContinuityAction =
  | "continue"
  | "watch_now"
  | "resume"
  | "finish_season"
  | "open_title"
  | "mark_watched"
  | "dismiss";

export type ContinuityAvailability = {
  region: "BR" | "US";
  providerName: string | null;
  providerLogoPath: string | null;
  providerId: number | null;
  type: "subscription" | "rent" | "buy" | "free" | "ads" | null;
  confidence:
    | "tmdb_only"
    | "watchmode_confirmed"
    | "movieofthenight_confirmed"
    | "mixed_confirmed"
    | "predicted_window"
    | "user_relevant_confirmed";
  isPreferred: boolean;
};

export type ContinuityProgress = {
  /** Percentual de episódios assistidos sobre o total aired (nunca sobre futuros). */
  percentage: number;

  watchedEpisodes?: number | null;
  /**
   * Total de episódios que já foram ao ar (aired).
   * Fonte de verdade para exibição de progresso na UI.
   * Nunca inclui episódios futuros ou placeholders do TMDB.
   */
  totalEpisodes?: number | null;

  currentSeason?: number | null;
  /** Último episódio assistido (= nextEpisode - 1). */
  currentEpisode?: number | null;

  nextSeason?: number | null;
  /** Próximo episódio a assistir — sempre aired, nunca futuro. */
  nextEpisode?: number | null;
  nextEpisodeAirDate?: string | null;

  runtimeMinutes?: number | null;
  remainingMinutes?: number | null;

  lastWatchedAt?: string | null;
};

export type HeroCandidate = {
  id: string;
  tmdbId: number;
  mediaType: ContinuityMediaType;

  title: string;
  overview: string | null;
  year: number | null;

  posterPath: string | null;
  backdropPath: string | null;
  alternateBackdropPath?: string | null;

  score: number;
  priority: number;

  context: ContinuityContext;
  contextLabel: string;
  reason: string;

  labels: string[];

  progress: ContinuityProgress;

  availability: ContinuityAvailability | null;

    actions: {
    primary: ContinuityAction;
    secondary?: ContinuityAction;
  };

  serverEyebrow?: {
    text: string;
    color: string;
  };

    debug?: {
    scoreBreakdown?: Record<string, number>;
    source?: string;
    [key: string]: unknown;
  };
};

export type HeroCandidatesResult = {
  candidates: HeroCandidate[];
  generatedAt: string;
};

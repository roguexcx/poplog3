import type {
  ComputedState,
  UserTitleState,
} from "@/server/state/user-title-state";
import type { LeavingItem } from "@/app/api/poplog3/agenda/leaving-soon/route";
import type { NewEpisodeItem } from "@/app/api/poplog3/continuity/new-episodes/route";
import type { UpcomingEpisodeItem } from "@/app/api/poplog3/continuity/upcoming-episodes/route";

export type AgendaEventType =
  | "episode_new"
  | "season_premiere"
  | "season_finale"
  | "mid_season_finale"
  | "hiatus_return"
  | "series_premiere"
  | "movie_theatrical"
  | "movie_streaming"
  | "movie_digital"
  | "leaving_soon";

export type AgendaTemporalLayer =
  | "today"
  | "tonight"
  | "tomorrow"
  | "this_week"
  | "next_week"
  | "this_month"
  | "beyond";

export type AgendaProvider = {
  name: string;
  logo: string | null;
  type: string;
};

export type AgendaVisualWeight = "hero" | "card" | "row";

export type AgendaEvent = {
  id: string;
  type: AgendaEventType;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  layer: AgendaTemporalLayer;
  airDate: string | null;
  daysUntil: number | null;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeName?: string | null;
  episodeStillPath?: string | null;
  runtime?: number | null;
  isSeasonFinale?: boolean;
  isSeriesFinale?: boolean;
  provider?: AgendaProvider;
  userState?: ComputedState | null;
  episodesBehind?: number;
  visualWeight: AgendaVisualWeight;
  score: number;
};

export type AgendaTimelineGroup = {
  layer: AgendaTemporalLayer;
  title: string;
  events: AgendaEvent[];
};

export type DateRange = {
  start: string;
  end: string;
};

export type DiscoverQuery = {
  mediaType: "movie" | "tv";
  region?: string;
  dateRange?: DateRange;
  providerIds?: number[];
  keywords?: number[];
  minVoteCount?: number;
  minVoteAverage?: number;
  page?: number;
};

export type MonitoredTitleState = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  lastChecked: string;
  lastKnownNextEpisode: string | null;
  lastKnownProvider: string | null;
  lastKnownStatus: string | null;
};

export type AgendaV2Response = {
  personal: {
    today: AgendaEvent[];
    thisWeek: AgendaEvent[];
    upcoming: AgendaEvent[];
    leavingSoon: AgendaEvent[];
    delayed: AgendaEvent[];
  };
  calendar: {
    byProvider: Record<string, AgendaEvent[]>;
    cinemaHighlights: AgendaEvent[];
    soonOnStreaming: AgendaEvent[];
  };
  timeline: AgendaTimelineGroup[];
  meta: {
    generatedAt: string;
    userHasLibrary: boolean;
    cacheStrategy: "fresh" | "stale" | "fallback";
  };
};

export type UserTitleStateByKey = Map<string, UserTitleState>;

export type LegacyAgendaMovie = {
  id: number;
  media_type: "movie";
  title: string;
  original_language?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  genre_ids: number[];
  user_status?: string | null;
  /** Score editorial: popularidade normalizada + bônus BR (quando aplicável). */
  editorial_score?: number;
  /** Bônus BR concedido — 0 se não for produção brasileira elegível. */
  br_bonus?: number;
};

export type LegacyAgendaTv = {
  id: number;
  media_type: "tv";
  title: string;
  original_language?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  genre_ids: number[];
  user_status?: string | null;
  /** Score editorial: popularidade normalizada + bônus BR (quando aplicável). */
  editorial_score?: number;
  /** Bônus BR concedido — 0 se não for produção brasileira elegível. */  br_bonus?: number;
};

export type AgendaV2CompatResponse = AgendaV2Response & {
  nowPlaying: LegacyAgendaMovie[];
  upcoming: LegacyAgendaMovie[];
  airingToday: LegacyAgendaTv[];
  onTheAir: LegacyAgendaTv[];
  newSeries: LegacyAgendaTv[];
  soonToReturn: LegacyAgendaTv[];
  userLibraryIds: Record<string, string>;
  newEpisodes: NewEpisodeItem[];
  upcomingEpisodes: UpcomingEpisodeItem[];
  leavingSoonItems: LeavingItem[];
};

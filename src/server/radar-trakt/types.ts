import type { IcsAgendaResponse } from "@/app/api/ics/agenda/route";

export type RadarMode = "general" | "personal";
export type RadarMediaType = "show" | "movie" | "episode" | "unknown";
export type RadarContentType =
  | "series"
  | "movie"
  | "animation"
  | "anime"
  | "documentary"
  | "reality"
  | "talk_show"
  | "news"
  | "sports"
  | "live_event"
  | "kids"
  | "variety"
  | "soap"
  | "podcast"
  | "other"
  | "unknown";

export type RadarEventType =
  | "new_show"
  | "season_premiere"
  | "episode"
  | "multiple_episodes"
  | "season_drop"
  | "season_finale"
  | "series_finale"
  | "movie_theatrical"
  | "movie_digital"
  | "movie_streaming"
  | "movie_physical"
  | "movie_tv"
  | "movie_limited"
  | "movie_premiere"
  | "anticipated_with_date"
  | "recent_release"
  | "unknown_dated_event";

export type RadarBucketId = "now" | "highlights" | "week" | "next" | "recent" | "anticipated";

export interface RadarEventIds {
  poplog?: string | number | null;
  trakt?: number | string | null;
  imdb?: string | null;
  tvdb?: number | string | null;
  tmdb?: number | null;
  slug?: string | null;
}

export interface RadarEvent {
  id: string;
  poplogId: string | number | null;
  titleId: string;
  mediaType: RadarMediaType;
  contentType: RadarContentType;
  eventType: RadarEventType;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  date: string;
  dateEnd: string | null;
  timezone: string | null;
  relativeDateLabel: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeCount: number | null;
  episodeRange: string | null;
  releaseType: string | null;
  country: string | null;
  source: string;
  confidence: "high" | "medium" | "low";
  poster: string | null;
  backdrop: string | null;
  ids: RadarEventIds;
  filters: string[];
  bucket: RadarBucketId | null;
  score: number;
  label: string;
  groupLabel: string | null;
  rawSourceRefs: Array<{ source: string; ref: string }>;
}

export interface RadarSection {
  id: RadarBucketId;
  title: string;
  description: string;
  items: RadarEvent[];
  count: number;
  window: { start: string | null; end: string | null };
}

export interface RadarFilter {
  id: string;
  label: string;
  group: "contentType" | "eventType" | "timeWindow" | "releaseType";
  count: number;
}

export interface RadarStats {
  rawEvents: number;
  normalizedEvents: number;
  groupedEvents: number;
  discarded: number;
  sectionCounts: Record<RadarBucketId, number>;
}

export interface RadarPayload {
  mode: RadarMode;
  source: "trakt";
  generatedAt: string;
  cachedAt?: string;
  fromCache: boolean;
  cacheVersion: number;
  region: string;
  language: string;
  sections: Record<RadarBucketId, RadarSection>;
  filters: RadarFilter[];
  stats: RadarStats;
  debug?: Record<string, unknown>;
  libraryFiltered?: boolean;
  librarySize?: number;
  matchedCount?: number;
  missingLibraryCount?: number;
  general?: IcsAgendaResponse;
}

export interface RadarLibraryIdentity {
  librarySize: number;
  poplogIds: Set<string>;
  traktIds: Set<string>;
  imdbIds: Set<string>;
  tvdbIds: Set<string>;
  tmdbTvIds: Set<number>;
  tmdbMovieIds: Set<number>;
  slugs: Set<string>;
  titles: Set<string>;
}

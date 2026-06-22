export type ContentType = "serie" | "filme";

export type WatchStatus =
  | "watching"
  | "paused"
  | "abandoned"
  | "finished"
  | "watchlist";

import type { SeriesStatus } from "@/lib/series";

export type { SeriesStatus };

export type SignalType =
  | "watched_episode"
  | "snoozed"
  | "clicked_hero"
  | "clicked_not_now"
  | "finished"
  | "abandoned"
  | "added_watchlist"
  | "removed_watchlist"
  | "rated";

export interface UserWatching {
  id: string;
  user_id: string;
  content_id: string;
  content_type: ContentType;
  title: string;
  original_title?: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  alternate_backdrop_path?: string | null;
  dominant_color: string | null;

  status: WatchStatus;

  // Series
  current_season: number | null;
  current_episode: number | null;
  total_seasons: number | null;
  total_episodes_season: number | null;
  episodes_watched: number | null;
  next_episode_name: string | null;
  next_episode_duration: number | null;
  next_episode_duration_label?: string | null;
  next_episode_air_date: string | null;
  series_status: SeriesStatus | null;
  new_episode_available: boolean;
  new_episode_available_since: string | null;

  // Movie
  runtime: number | null;
  runtime_label?: string | null;
  remaining_runtime_label?: string | null;
  watch_progress_minutes: number | null;

  // Streaming
  streaming_platform: string | null;
  streaming_available_since: string | null;
  /** Badge de disponibilidade (Onde assistir) — mesmo contrato do card da Watchlist. */
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
  available_on_vod: boolean;
  vod_available_since: string | null;

  // Rating
  tmdb_rating: number | null;
  user_rating: number | null;

  // Temporal behaviour
  last_watched_at: string | null;
  last_session_duration: number | null;
  sessions_last_7_days: number;
  sessions_last_30_days: number;
  average_session_gap_days: number | null;
  is_marathon: boolean;

  // Curadoria
  priority_score: number;
  priority_last_calculated_at: string | null;
  snoozed_until: string | null;
  snooze_count: number;
  hero_shown_count: number;
  hero_last_shown_at: string | null;
  rediscovery_eligible: boolean;

  // Metadata
  added_to_watchlist_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  genres: string[] | null;
  year: number | null;

  // Episode still (series only); movies can use alternate_backdrop_path instead.
  next_episode_still_path: string | null;

  // Franchise / collection (movies only)
  belongs_to_collection: { id: number; name: string; poster_path: string | null } | null;

  created_at: string;
  updated_at: string;
}

export interface UserCuradoriaPreferences {
  user_id: string;
  preferred_session_duration_minutes: number;
  typical_watch_days: string[] | null;
  typical_watch_time_start: number | null;
  typical_watch_time_end: number | null;
  top_genres: string[] | null;
  top_platforms: string[] | null;
  avg_episodes_per_session: number | null;
  prefers_short_content: boolean;
  binge_tendency_score: number;
  updated_at: string;
}

export interface ScoredItem extends UserWatching {
  score: number;
  scoreBreakdown?: ScoreBreakdown;
}

export interface ScoreBreakdown {
  f1_recency: number;
  f2_urgency: number;
  f3_new_episode: number;
  f4_streaming: number;
  f5_quality: number;
  f6_duration: number;
  f7_genre: number;
  f8_freshness: number;
  f9_rediscovery: number;
  total: number;
}

export interface HeroCTA {
  primary: string;
  icon: "play" | "sparkles" | "flag";
}

export interface HeroEyebrow {
  text: string;
  color: string;
}

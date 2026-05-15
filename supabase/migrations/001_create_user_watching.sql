-- Migration 001: user_watching
-- Tracks user progress, metadata and curadoria scoring for every title.

create table if not exists user_watching (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  content_id text not null,
  content_type text not null check (content_type in ('serie', 'filme')),
  title text not null,
  poster_path text,
  backdrop_path text,
  dominant_color text,

  -- Progress
  status text not null default 'watching'
    check (status in ('watching', 'paused', 'abandoned', 'finished', 'watchlist')),

  -- Series-specific
  current_season int,
  current_episode int,
  total_seasons int,
  total_episodes_season int,
  episodes_watched int default 0,
  next_episode_name text,
  next_episode_duration int,
  next_episode_air_date timestamptz,
  series_status text check (
    series_status in ('returning', 'ended', 'canceled', 'hiatus', 'in_production')
  ),
  new_episode_available boolean default false,
  new_episode_available_since timestamptz,

  -- Movie-specific
  runtime int,
  watch_progress_minutes int default 0,

  -- Streaming
  streaming_platform text,
  streaming_available_since timestamptz,
  available_on_vod boolean default false,
  vod_available_since timestamptz,

  -- Rating
  tmdb_rating numeric(3,1),
  user_rating int check (user_rating between 1 and 10),

  -- Temporal behaviour
  last_watched_at timestamptz,
  last_session_duration int,
  sessions_last_7_days int default 0,
  sessions_last_30_days int default 0,
  average_session_gap_days numeric(5,2),
  is_marathon boolean default false,

  -- Curadoria
  priority_score numeric(8,4) default 0,
  priority_last_calculated_at timestamptz,
  snoozed_until timestamptz,
  snooze_count int default 0,
  hero_shown_count int default 0,
  hero_last_shown_at timestamptz,
  rediscovery_eligible boolean default false,

  -- Metadata
  added_to_watchlist_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  genres text[],
  year int,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (user_id, content_id)
);

-- RLS
alter table user_watching enable row level security;

create policy "users can manage own watching"
  on user_watching
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Performance indexes
create index on user_watching (user_id, status);
create index on user_watching (user_id, priority_score desc);
create index on user_watching (user_id, last_watched_at desc);

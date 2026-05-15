-- Migration 003: user_curadoria_preferences
-- Consumption profile derived from user behaviour over time.

create table if not exists user_curadoria_preferences (
  user_id uuid primary key references auth.users,

  -- Session habits
  preferred_session_duration_minutes int default 60,
  typical_watch_days text[],
  typical_watch_time_start int check (typical_watch_time_start between 0 and 23),
  typical_watch_time_end int check (typical_watch_time_end between 0 and 23),

  -- Auto-calculated genre / platform affinities
  top_genres text[],
  top_platforms text[],

  -- Behaviour profile
  avg_episodes_per_session numeric(4,2),
  prefers_short_content boolean default false,
  binge_tendency_score numeric(3,2) default 0.5
    check (binge_tendency_score between 0 and 1),

  updated_at timestamptz default now()
);

-- RLS
alter table user_curadoria_preferences enable row level security;

create policy "users can manage own preferences"
  on user_curadoria_preferences
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Migration 004: hero_spotlight_sessions
-- Tracks every impression in the Hero carousel for anti-repetition and analytics.

create table if not exists hero_spotlight_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  content_id text not null,
  shown_at timestamptz default now(),
  position int check (position between 1 and 5),
  score_at_time numeric(8,4),
  cta_clicked text,
  time_visible_seconds int
);

-- RLS
alter table hero_spotlight_sessions enable row level security;

create policy "users can manage own hero sessions"
  on hero_spotlight_sessions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Index for freshness lookups
create index on hero_spotlight_sessions (user_id, content_id, shown_at desc);

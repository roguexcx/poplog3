-- Migration 002: user_curadoria_signals
-- Behavioural event log that feeds the scoring engine.

create table if not exists user_curadoria_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  content_id text not null,
  signal_type text not null check (
    signal_type in (
      'watched_episode',
      'snoozed',
      'clicked_hero',
      'clicked_not_now',
      'finished',
      'abandoned',
      'added_watchlist',
      'removed_watchlist',
      'rated'
    )
  ),
  signal_value jsonb,
  created_at timestamptz default now()
);

-- RLS
alter table user_curadoria_signals enable row level security;

create policy "users can manage own signals"
  on user_curadoria_signals
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Index for recent signal queries
create index on user_curadoria_signals (user_id, created_at desc);
create index on user_curadoria_signals (user_id, content_id, signal_type);

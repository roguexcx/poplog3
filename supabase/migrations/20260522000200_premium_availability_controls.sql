-- Premium availability controls:
-- - cache metadata on provider rows
-- - persist empty/error fallback attempts
-- - persist API budget consumption

alter table if exists public.poplog3_title_availability
  add column if not exists provider_confidence text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists fallback_checked_at timestamptz,
  add column if not exists fallback_result text,
  add column if not exists fallback_source text,
  add column if not exists next_fallback_allowed_at timestamptz;

create table if not exists public.poplog3_availability_fallback_state (
  tmdb_id integer not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  region text not null,
  fallback_source text not null,
  fallback_checked_at timestamptz not null default now(),
  fallback_result text not null,
  next_fallback_allowed_at timestamptz not null,
  reason text,
  origin_endpoint text,
  user_id uuid,
  action text,
  rows_count integer not null default 0,
  error text,
  updated_at timestamptz not null default now(),
  primary key (tmdb_id, media_type, region, fallback_source)
);

create index if not exists poplog3_availability_fallback_state_next_idx
  on public.poplog3_availability_fallback_state (next_fallback_allowed_at);

create table if not exists public.poplog3_premium_api_usage (
  id uuid primary key default gen_random_uuid(),
  api text not null check (api in ('omdb', 'watchmode', 'movieofthenight')),
  period_day date not null default current_date,
  period_month text not null default to_char(now(), 'YYYY-MM'),
  used_at timestamptz not null default now(),
  endpoint text,
  tmdb_id integer,
  media_type text check (media_type in ('movie', 'tv')),
  region text,
  user_id uuid,
  action text,
  reason text,
  status text not null default 'reserved',
  daily_used integer,
  daily_limit integer,
  monthly_used integer,
  monthly_limit integer,
  error text
);

create index if not exists poplog3_premium_api_usage_api_day_idx
  on public.poplog3_premium_api_usage (api, period_day);

create index if not exists poplog3_premium_api_usage_api_month_idx
  on public.poplog3_premium_api_usage (api, period_month);

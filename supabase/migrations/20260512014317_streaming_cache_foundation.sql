create table if not exists public.streaming_providers (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null,
  provider_slug text not null,
  logo_url text,
  tmdb_provider_id integer,
  watchmode_source_id integer,
  motn_provider_id text,
  country text not null default 'BR',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint streaming_providers_country_slug_key unique (country, provider_slug),
  constraint streaming_providers_country_tmdb_key unique (country, tmdb_provider_id),
  constraint streaming_providers_country_watchmode_key unique (country, watchmode_source_id),
  constraint streaming_providers_country_motn_key unique (country, motn_provider_id)
);

create table if not exists public.title_external_ids (
  id uuid primary key default gen_random_uuid(),
  tmdb_id integer not null,
  imdb_id text,
  tvdb_id text,
  trakt_id text,
  watchmode_id integer,
  motn_id text,
  media_type text not null check (media_type in ('movie', 'tv')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint title_external_ids_tmdb_media_key unique (tmdb_id, media_type)
);

create table if not exists public.title_streaming_availability (
  id uuid primary key default gen_random_uuid(),
  tmdb_id integer not null,
  imdb_id text,
  media_type text not null check (media_type in ('movie', 'tv')),
  country text not null default 'BR',
  provider_id uuid references public.streaming_providers(id) on delete set null,
  access_type text not null check (access_type in ('subscription', 'rent', 'buy', 'free', 'ads', 'cinema', 'unknown')),
  stream_status text not null,
  legacy_stream_status text,
  source_api text not null check (source_api in ('tmdb', 'watchmode', 'movieofthenight', 'inference', 'cache')),
  source_confidence integer not null default 0 check (source_confidence >= 0 and source_confidence <= 100),
  available_abroad boolean not null default false,
  inferred boolean not null default false,
  deep_link text,
  quality text,
  audio_languages text[] not null default '{}',
  subtitle_languages text[] not null default '{}',
  origin text check (origin in ('cinema', 'streaming')),
  estimated_platform text,
  estimated_month text,
  estimated_pvod_month text,
  context_pool text[] not null default '{}',
  source_apis text[] not null default '{}',
  first_detected_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  cache_valid_until timestamptz not null,
  raw_payload_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.api_sync_logs (
  id uuid primary key default gen_random_uuid(),
  api_name text not null check (api_name in ('tmdb', 'watchmode', 'movieofthenight', 'cache')),
  endpoint text not null,
  status text,
  response_time_ms integer,
  success boolean not null default false,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists streaming_providers_country_active_idx
  on public.streaming_providers (country, is_active);

create index if not exists title_streaming_availability_lookup_idx
  on public.title_streaming_availability (tmdb_id, media_type, country, cache_valid_until);

create index if not exists title_streaming_availability_provider_idx
  on public.title_streaming_availability (provider_id, access_type, country);

create unique index if not exists title_streaming_availability_provider_uidx
  on public.title_streaming_availability (tmdb_id, media_type, country, provider_id, access_type, source_api)
  where provider_id is not null;

create unique index if not exists title_streaming_availability_no_provider_uidx
  on public.title_streaming_availability (tmdb_id, media_type, country, access_type, source_api)
  where provider_id is null;

create index if not exists api_sync_logs_api_created_idx
  on public.api_sync_logs (api_name, created_at desc);

create index if not exists title_external_ids_imdb_idx
  on public.title_external_ids (imdb_id)
  where imdb_id is not null;

create or replace function public.touch_streaming_cache_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_streaming_providers_updated_at on public.streaming_providers;
create trigger touch_streaming_providers_updated_at
before update on public.streaming_providers
for each row
execute function public.touch_streaming_cache_updated_at();

drop trigger if exists touch_title_streaming_availability_updated_at on public.title_streaming_availability;
create trigger touch_title_streaming_availability_updated_at
before update on public.title_streaming_availability
for each row
execute function public.touch_streaming_cache_updated_at();

drop trigger if exists touch_title_external_ids_updated_at on public.title_external_ids;
create trigger touch_title_external_ids_updated_at
before update on public.title_external_ids
for each row
execute function public.touch_streaming_cache_updated_at();

alter table public.streaming_providers enable row level security;
alter table public.title_streaming_availability enable row level security;
alter table public.api_sync_logs enable row level security;
alter table public.title_external_ids enable row level security;

revoke all on table public.streaming_providers from anon, authenticated;
revoke all on table public.title_streaming_availability from anon, authenticated;
revoke all on table public.api_sync_logs from anon, authenticated;
revoke all on table public.title_external_ids from anon, authenticated;

grant select, insert, update, delete on table public.streaming_providers to service_role;
grant select, insert, update, delete on table public.title_streaming_availability to service_role;
grant select, insert on table public.api_sync_logs to service_role;
grant select, insert, update, delete on table public.title_external_ids to service_role;

revoke execute on function public.touch_streaming_cache_updated_at() from anon;
revoke execute on function public.touch_streaming_cache_updated_at() from authenticated;
revoke execute on function public.touch_streaming_cache_updated_at() from public;

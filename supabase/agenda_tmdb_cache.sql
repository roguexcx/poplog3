create table if not exists public.agenda_tmdb_cache (
  cache_key text primary key,
  tmdb_id integer,
  media_type text,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agenda_tmdb_cache_expires_at_idx
  on public.agenda_tmdb_cache (expires_at);

create index if not exists agenda_tmdb_cache_title_idx
  on public.agenda_tmdb_cache (media_type, tmdb_id);

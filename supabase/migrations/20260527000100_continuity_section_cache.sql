-- Cache persistente dos blocos da pagina /acompanhando.
-- Mantem hero/watchlist cache-first tambem apos restart/deploy.

create table if not exists public.continuity_section_cache (
  id uuid primary key default gen_random_uuid(),
  section_key text not null,
  user_id uuid references auth.users(id) on delete cascade,
  region text,
  language text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.continuity_section_cache enable row level security;

create policy "users read own continuity section cache"
  on public.continuity_section_cache for select
  using (auth.uid() = user_id);

create policy "service role writes continuity section cache"
  on public.continuity_section_cache for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists continuity_section_cache_section_key_idx
  on public.continuity_section_cache (section_key);

create index if not exists continuity_section_cache_user_id_idx
  on public.continuity_section_cache (user_id);

create index if not exists continuity_section_cache_expires_at_idx
  on public.continuity_section_cache (expires_at);

create unique index if not exists continuity_section_cache_unique_idx
  on public.continuity_section_cache (section_key, user_id, region, language)
  nulls not distinct;

create index if not exists continuity_section_cache_lookup_idx
  on public.continuity_section_cache (
    section_key,
    user_id,
    region,
    language,
    expires_at desc
  );

create index if not exists poplog3_titles_media_tmdb_idx
  on public.poplog3_titles (media_type, tmdb_id);

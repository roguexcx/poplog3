-- Migration 022: Sistema oficial de avaliações POPLOG
-- user_ratings  → avaliação pessoal do usuário (0–5, com meia-estrela)
-- rating_aggregates → médias públicas da comunidade por título/temporada/episódio
--
-- Filosofia:
--   • Nota pessoal e nota comunitária ficam separadas.
--   • rating_source diferencia avaliação explícita de estimada (inferred/system_estimate).
--   • Recálculo dos agregados é feito pela aplicação após cada mutação.
--   • Suporte futuro a avaliações por episódio e temporada sem alterar o schema.

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER: updated_at automático
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- user_ratings
-- Uma linha por (usuário × item). Item = filme | série | temporada | episódio.
-- Unicidade garantida pelo item_key gerado automaticamente.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.user_ratings (
  id               uuid    primary key default gen_random_uuid(),

  -- Quem avaliou
  user_id          uuid    not null references auth.users(id) on delete cascade,

  -- O quê foi avaliado
  media_type       text    not null check (media_type in ('movie', 'tv', 'season', 'episode')),
  tmdb_id          integer not null,
  season_number    smallint,                                        -- nulo para filme/série
  episode_number   smallint,                                        -- nulo para filme/série/temporada

  -- Chave derivada para upsert e índice único (evita problema de NULL != NULL)
  item_key         text    generated always as (
    media_type || ':' || tmdb_id::text
    || ':' || coalesce(season_number::text, '')
    || ':' || coalesce(episode_number::text, '')
  ) stored,

  -- A nota em si
  rating           numeric(3,1) not null check (rating >= 0 and rating <= 5),

  -- Como foi gerada a nota
  rating_source    text    not null default 'explicit'
                   check (rating_source in ('explicit', 'inferred', 'imported', 'system_estimate')),

  -- Visibilidade pública (para agregados)
  is_public        boolean not null default true,

  -- Timestamps
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Unicidade real: um usuário, um item
create unique index if not exists user_ratings_user_item_idx
  on public.user_ratings (user_id, item_key);

-- Busca por usuário (carregamento da biblioteca/perfil)
create index if not exists user_ratings_user_idx
  on public.user_ratings (user_id);

-- Busca por item (recálculo de agregados)
create index if not exists user_ratings_item_idx
  on public.user_ratings (media_type, tmdb_id)
  where is_public = true;

-- updated_at automático
create trigger user_ratings_updated_at
  before update on public.user_ratings
  for each row execute function public.set_updated_at();

-- RLS: usuário só acessa suas próprias avaliações
alter table public.user_ratings enable row level security;

create policy "users manage own ratings"
  on public.user_ratings for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- rating_aggregates
-- Médias públicas da comunidade. Recalculadas pela app após cada mutação.
-- Uma linha por item (filme | série | temporada | episódio).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.rating_aggregates (
  id                    uuid    primary key default gen_random_uuid(),

  -- O item
  media_type            text    not null check (media_type in ('movie', 'tv', 'season', 'episode')),
  tmdb_id               integer not null,
  season_number         smallint,
  episode_number        smallint,

  -- Mesma chave derivada do user_ratings para consistência
  item_key              text    generated always as (
    media_type || ':' || tmdb_id::text
    || ':' || coalesce(season_number::text, '')
    || ':' || coalesce(episode_number::text, '')
  ) stored,

  -- Métricas agregadas (escala 0–5)
  average_rating        numeric(4,2),          -- média aritmética das notas explícitas + inferidas
  explicit_avg_rating   numeric(4,2),          -- média só das notas explícitas (fonte de verdade)
  rating_count          integer not null default 0,
  explicit_rating_count integer not null default 0,
  inferred_rating_count integer not null default 0,

  -- Confiabilidade: low (<5 votos) | medium (5-49) | high (≥50)
  confidence_level      text    not null default 'low'
                        check (confidence_level in ('low', 'medium', 'high')),

  -- Timestamps
  updated_at            timestamptz not null default now()
);

-- Unicidade por item
create unique index if not exists rating_aggregates_item_idx
  on public.rating_aggregates (item_key);

-- Leitura pontual (página de título)
create index if not exists rating_aggregates_lookup_idx
  on public.rating_aggregates (media_type, tmdb_id);

-- updated_at automático
create trigger rating_aggregates_updated_at
  before update on public.rating_aggregates
  for each row execute function public.set_updated_at();

-- RLS: leitura pública; escrita só via service_role (a app recalcula no backend)
alter table public.rating_aggregates enable row level security;

create policy "public can read aggregates"
  on public.rating_aggregates for select
  using (true);

-- Somente service_role escreve (recálculo server-side)
-- (authenticated e anon não têm INSERT/UPDATE/DELETE por padrão com RLS ativo)

-- Migration 005: user_title_state + user_events
-- Engine global de estado do usuário — substitui cálculos dispersos por uma
-- única fonte de verdade atualizada em todo evento de escrita.

-- ─────────────────────────────────────────────────────────────────────────────
-- user_title_state
-- Caixinha global por usuário × título.
-- Atualizada após todo toggle, bulk mark, mudança de status, sync de availability.
-- Lida por Hero, Acompanhando, Biblioteca, Página de Título.
--
-- computed_state (TV):  watchlist | in_progress | up_to_date | completed | abandoned | fridge
-- computed_state (movie): watchlist | in_progress | watched | abandoned | fridge
--
--   watchlist   → salvo, nunca iniciado
--   in_progress → assistindo, há episódios aired não vistos (série atrasada)
--   up_to_date  → assistindo, em dia com todos os aired (série em dia)
--   completed   → em dia + série encerrada/cancelada, ou marcado manualmente como watched
--   watched     → filme marcado como assistido
--   abandoned   → abandonado
--   fridge      → geladeira
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists user_title_state (
  id           uuid    primary key default gen_random_uuid(),
  user_id      uuid    not null references auth.users(id) on delete cascade,
  tmdb_id      integer not null,
  media_type   text    not null check (media_type in ('movie', 'tv')),

  -- ── Biblioteca (espelho do poplog3_user_titles) ────────────────────────
  status       text    check (status in ('watchlist','watching','watched','abandoned','fridge')),
  favorite     boolean not null default false,
  liked        boolean,           -- null = sem opinião

  -- ── Estado computado (fonte de verdade para UI) ────────────────────────
  computed_state text   check (computed_state in (
    'watchlist','in_progress','up_to_date','completed','watched','abandoned','fridge'
  )),

  -- ── Progresso de episódios (TV apenas) ────────────────────────────────
  watched_episodes  integer  not null default 0,
  aired_episodes    integer  not null default 0,
  total_episodes    integer,                     -- total TMDB (pode incluir futuros)
  progress_pct      smallint not null default 0, -- baseado em aired_episodes
  next_season       smallint,
  next_episode      smallint,
  next_episode_air_date date,
  last_watched_at   timestamptz,
  watched_keys      text[]   not null default '{}',  -- ["S01E01","S01E02",…]

  -- ── Franquia (Movie apenas) ───────────────────────────────────────────
  franchise_tmdb_id integer,    -- TMDB collection id
  franchise_name    text,
  franchise_watched integer,    -- quantos filmes da franquia o usuário já viu
  franchise_total   integer,    -- total de filmes da franquia no catálogo

  -- ── Melhor streaming disponível ───────────────────────────────────────
  -- Alimentado separadamente por refreshTitleStateAvailability().
  -- Considera preferências do usuário: subscription > free > rent/buy.
  best_provider_name text,
  best_provider_type text,      -- subscription | rent | buy | free | ads
  best_provider_logo text,

  -- ── Timestamps ────────────────────────────────────────────────────────
  last_event_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (user_id, tmdb_id, media_type)
);

-- Leitura por usuário (lista, Hero, Acompanhando)
create index if not exists user_title_state_user_idx
  on user_title_state (user_id);

-- Filtro por status de biblioteca
create index if not exists user_title_state_user_status_idx
  on user_title_state (user_id, status)
  where status is not null;

-- Filtro por estado computado (séries em dia, atrasadas, etc.)
create index if not exists user_title_state_user_computed_idx
  on user_title_state (user_id, computed_state)
  where computed_state is not null;

-- Leitura pontual por título (página de título, toggle)
create index if not exists user_title_state_lookup_idx
  on user_title_state (user_id, tmdb_id, media_type);

-- RLS: usuário só acessa seu próprio estado
alter table user_title_state enable row level security;

create policy "users see own title state"
  on user_title_state for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- user_events
-- Log imutável de todas as ações do usuário.
-- Fonte de verdade para auditoria, analytics, future undo e recomendações.
--
-- event_type:
--   episode_watched | episode_unwatched
--   season_marked   | season_unmarked
--   series_completed | series_reset
--   status_changed  | movie_watched
--   franchise_updated | availability_synced
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists user_events (
  id          uuid    primary key default gen_random_uuid(),
  user_id     uuid    not null references auth.users(id) on delete cascade,
  tmdb_id     integer not null,
  media_type  text    not null check (media_type in ('movie', 'tv')),
  event_type  text    not null,
  payload     jsonb   not null default '{}',
  created_at  timestamptz not null default now()
);

-- Timeline de atividade do usuário (mais recente primeiro)
create index if not exists user_events_user_time_idx
  on user_events (user_id, created_at desc);

-- Histórico de um título específico
create index if not exists user_events_title_idx
  on user_events (user_id, tmdb_id, media_type, created_at desc);

-- RLS: usuário só acessa seus próprios eventos
alter table user_events enable row level security;

create policy "users see own events"
  on user_events for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

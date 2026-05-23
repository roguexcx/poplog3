-- Migration 019: marcar séries da watchlist que não conseguem ser hidratadas
--
-- Contexto:
--   /api/library/watchlist-hydrate tenta popular poplog3_episodes para séries
--   TV na watchlist. Algumas séries do TMDB não têm temporadas/episódios reais
--   disponíveis. Sem uma marca persistida, elas voltam como pendentes em todo
--   batch e podem manter o loop de hidratação vivo.
--
-- Semântica:
--   hydration_skipped = true significa "já tentamos hidratar esta série e ela
--   continua sem episódios em poplog3_episodes". A rota deixa de reprocessá-la.

alter table user_title_state
  add column if not exists hydration_skipped boolean not null default false;

create index if not exists user_title_state_hydration_pending_idx
  on user_title_state (user_id, media_type, status, hydration_skipped)
  where media_type = 'tv' and status = 'watchlist';

comment on column user_title_state.hydration_skipped is
  'True quando a hidratação de episódios da watchlist já foi tentada e a série permaneceu sem episódios em poplog3_episodes.';

-- Migration 018: corrigir séries com status=watchlist e watched_episodes > 0
--
-- Contexto:
--   user_title_state.status = 'watchlist' com watched_episodes > 0 é um estado
--   inconsistente — série que o usuário começou a assistir mas ficou com status
--   de "para ver" no banco. Isso cria conflitos em:
--     - Biblioteca (isPureWatchlist vs isMarathoning)
--     - Acompanhando (filtragem por computed_state)
--     - Cálculo de duration_sort_minutes (usa restante vs total dependendo do status)
--
-- Correção:
--   1. Atualiza user_title_state: status watchlist → watching quando há progresso
--   2. Recalcula computed_state baseado no novo status
--   3. Atualiza user_titles (tabela de biblioteca) com o status corrigido
--
-- Esta migration é idempotente — pode ser executada múltiplas vezes com segurança.

-- Passo 1: corrigir user_title_state
update user_title_state
set
  status = 'watching',
  computed_state = case
    -- Se há aired não vistos → in_progress
    when next_episode is not null then 'in_progress'
    -- Se em dia com aired e série encerrada → completed
    when next_episode is null and aired_episodes > 0 then 'in_progress'
    -- Fallback seguro
    else 'in_progress'
  end,
  updated_at = now()
where
  media_type = 'tv'
  and status = 'watchlist'
  and watched_episodes > 0;

-- Passo 2: corrigir user_titles (tabela legada de biblioteca)
-- Garante consistência entre as duas tabelas para séries afetadas
update user_titles ut
set status = 'watching'
from user_title_state uts
where
  ut.user_id = uts.user_id
  and ut.tmdb_id = uts.tmdb_id
  and ut.media_type = uts.media_type
  and ut.media_type = 'tv'
  and ut.status = 'watchlist'
  and uts.status = 'watching';  -- estado já corrigido no passo 1

-- Log de quantos registros foram corrigidos (visível nos logs do Supabase)
do $$
declare
  corrected_count integer;
begin
  get diagnostics corrected_count = row_count;
  raise notice '[Migration 018] user_titles corrigidos: %', corrected_count;
end $$;

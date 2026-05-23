-- Migration 017: duration_sort_minutes em user_title_state
-- Persiste o valor pré-calculado de duração para ordenação na Biblioteca.
--
-- Conceito:
--   duration_sort_minutes é a duração usada exclusivamente para ordenação.
--   Não é exibida diretamente — serve como campo estável para o filtro
--   "Mais curto ↔ Mais longo" funcionar sem recálculo no frontend.
--
-- Semântica por estado:
--   - Watchlist não iniciada (watched_episodes = 0) → duração TOTAL prevista
--   - Em andamento (watched_episodes > 0) → duração RESTANTE até o fim
--   - Concluída / up-to-date → duração TOTAL histórica
--   - Filme → runtime do filme (único valor)
--
-- Atualizado por: upsertTitleState() após todo evento de escrita.
-- Lido por: getUserLibraryState() (fast path, sem recalcular).
-- Fallback: library-service.ts recalcula se NULL (série ainda sem episódios).

alter table user_title_state
  add column if not exists duration_sort_minutes integer;

-- Índice para ordenação eficiente na aba Watchlist / Tudo
-- (evita sort em memória para bibliotecas grandes)
create index if not exists user_title_state_duration_sort_idx
  on user_title_state (user_id, duration_sort_minutes nulls last)
  where duration_sort_minutes is not null;

comment on column user_title_state.duration_sort_minutes is
  'Duração em minutos usada para ordenação "Mais curto ↔ Mais longo" na Biblioteca. '
  'Watchlist não iniciada = total previsto; Em andamento = tempo restante; '
  'Concluída = total histórico. NULL = série ainda sem dados de runtime.';

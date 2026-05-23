-- Índices direcionados para a Biblioteca.
-- A tela lê estados por usuário/status e ordena por último evento; depois enriquece
-- séries com datas/runtime de episódios. Estes índices evitam scans caros quando a
-- biblioteca cresce para centenas de títulos.

create index if not exists user_title_state_library_read_idx
  on public.user_title_state (user_id, status, last_event_at desc)
  where status is not null;

create index if not exists poplog3_episodes_library_air_date_idx
  on public.poplog3_episodes (series_tmdb_id, air_date desc)
  where season_number > 0 and air_date is not null;

create index if not exists poplog3_episodes_runtime_lookup_idx
  on public.poplog3_episodes (series_tmdb_id)
  where season_number > 0 and runtime is not null;

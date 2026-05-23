-- Migration 021: backfill de duracao para filmes
--
-- Filmes nao precisam de hidratacao por episodios. A duracao ordenavel vem de:
--   1. user_title_state.duration_sort_minutes, se ja preenchido
--   2. poplog3_titles.runtime
--   3. tmdb_payload.runtime como fallback de cache legado
--   4. NULL apenas quando realmente nao ha runtime no cache

with movie_runtime as (
  select
    tmdb_id,
    coalesce(
      nullif(runtime, 0),
      nullif((tmdb_payload->>'runtime')::integer, 0)
    ) as runtime_minutes
  from poplog3_titles
  where media_type = 'movie'
)
update poplog3_titles t
set
  runtime = mr.runtime_minutes,
  updated_at = now()
from movie_runtime mr
where t.media_type = 'movie'
  and t.tmdb_id = mr.tmdb_id
  and t.runtime is null
  and mr.runtime_minutes is not null;

with movie_runtime as (
  select
    tmdb_id,
    coalesce(
      nullif(runtime, 0),
      nullif((tmdb_payload->>'runtime')::integer, 0)
    ) as runtime_minutes
  from poplog3_titles
  where media_type = 'movie'
),
resolved as (
  select
    uts.user_id,
    uts.tmdb_id,
    mr.runtime_minutes
  from user_title_state uts
  left join movie_runtime mr on mr.tmdb_id = uts.tmdb_id
  where uts.media_type = 'movie'
)
update user_title_state uts
set
  duration_sort_minutes = r.runtime_minutes,
  duration_sort_unavailable = r.runtime_minutes is null,
  updated_at = now()
from resolved r
where uts.user_id = r.user_id
  and uts.tmdb_id = r.tmdb_id
  and uts.media_type = 'movie'
  and (
    uts.duration_sort_minutes is distinct from r.runtime_minutes
    or uts.duration_sort_unavailable is distinct from (r.runtime_minutes is null)
  );

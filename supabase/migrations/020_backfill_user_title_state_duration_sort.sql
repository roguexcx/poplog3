-- Migration 020: backfill de duration_sort_minutes e fila separada de duracao
--
-- Separacao conceitual:
--   - hydration_skipped: nao ha episodios em poplog3_episodes
--   - duration_sort_unavailable: ha titulo/episodios, mas nao ha runtime suficiente
--
-- Esta migration preenche duration_sort_minutes para registros antigos que ja
-- existiam antes da coluna ser criada.

alter table user_title_state
  add column if not exists duration_sort_unavailable boolean not null default false;

create index if not exists user_title_state_duration_backfill_idx
  on user_title_state (user_id, media_type, status, duration_sort_unavailable)
  where duration_sort_minutes is null;

with episode_stats as (
  select
    series_tmdb_id as tmdb_id,
    count(*) filter (where season_number > 0) as episode_count,
    count(*) filter (
      where season_number > 0
        and air_date is not null
        and air_date <= current_date
    ) as aired_count,
    round(avg(runtime) filter (
      where season_number > 0
        and runtime is not null
        and runtime > 0
    ))::integer as avg_episode_runtime
  from poplog3_episodes
  group by series_tmdb_id
),
title_runtime as (
  select
    t.tmdb_id,
    t.media_type,
    t.runtime,
    t.number_of_episodes,
    (
      select round(avg(v))::integer
      from unnest(t.episode_run_time) as v
      where v > 0
    ) as episode_run_time_avg
  from poplog3_titles t
),
computed as (
  select
    uts.user_id,
    uts.tmdb_id,
    uts.media_type,
    case
      when uts.media_type = 'movie' and tr.runtime > 0 then tr.runtime
      when uts.media_type = 'tv' then
        (
          coalesce(es.avg_episode_runtime, tr.episode_run_time_avg, tr.runtime)
          *
          greatest(
            coalesce(
              nullif(es.aired_count, 0),
              nullif(tr.number_of_episodes, 0),
              nullif(uts.total_episodes, 0),
              nullif(es.episode_count, 0)
            ) - coalesce(uts.watched_episodes, 0),
            0
          )
        )
      else null
    end as remaining_runtime,
    case
      when uts.media_type = 'movie' and tr.runtime > 0 then tr.runtime
      when uts.media_type = 'tv' then
        (
          coalesce(es.avg_episode_runtime, tr.episode_run_time_avg, tr.runtime)
          *
          coalesce(
            nullif(es.aired_count, 0),
            nullif(tr.number_of_episodes, 0),
            nullif(uts.total_episodes, 0),
            nullif(es.episode_count, 0)
          )
        )
      else null
    end as total_runtime
  from user_title_state uts
  left join title_runtime tr
    on tr.tmdb_id = uts.tmdb_id
   and tr.media_type = uts.media_type
  left join episode_stats es
    on es.tmdb_id = uts.tmdb_id
  where uts.duration_sort_minutes is null
),
resolved as (
  select
    user_id,
    tmdb_id,
    media_type,
    case
      when remaining_runtime is not null and remaining_runtime > 0 then remaining_runtime
      when total_runtime is not null and total_runtime > 0 then total_runtime
      else null
    end as duration_sort_minutes
  from computed
)
update user_title_state uts
set
  duration_sort_minutes = r.duration_sort_minutes,
  duration_sort_unavailable = r.duration_sort_minutes is null,
  updated_at = now()
from resolved r
where uts.user_id = r.user_id
  and uts.tmdb_id = r.tmdb_id
  and uts.media_type = r.media_type
  and uts.duration_sort_minutes is null;

comment on column user_title_state.duration_sort_unavailable is
  'True quando duration_sort_minutes foi tentado, mas nao ha dados de runtime suficientes para calcular a duracao.';

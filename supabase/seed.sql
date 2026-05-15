-- Seed data for development
-- Replace the user_id below with your actual Supabase Auth user UUID.
-- Run: select id from auth.users limit 1;  to find it.

do $$
declare
  dev_user uuid := 'bb513536-20ff-4cbb-8c68-3bfd28d88ec4'; -- psatheler@gmail.com (usuário principal dev)
begin

-- Upsert default preferences for the dev user
insert into user_curadoria_preferences (
  user_id, preferred_session_duration_minutes, typical_watch_days,
  typical_watch_time_start, typical_watch_time_end,
  top_genres, top_platforms, avg_episodes_per_session, binge_tendency_score
) values (
  dev_user, 75, array['thursday','friday','saturday','sunday'],
  20, 23,
  array['Drama', 'Comedy', 'Thriller', 'Crime'],
  array['Netflix', 'Max', 'Prime Video'],
  2.4, 0.72
) on conflict (user_id) do nothing;

-- 1. Only Murders in the Building — novo episódio disponível (6h atrás)
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, current_episode, total_seasons, total_episodes_season,
  episodes_watched, next_episode_name, next_episode_duration,
  series_status, new_episode_available, new_episode_available_since,
  streaming_platform, tmdb_rating, last_watched_at, sessions_last_7_days,
  genres, year, priority_score
) values (
  dev_user, 'tmdb-tv-107113', 'serie', 'Only Murders in the Building',
  '/dWCRLFyVB0hCT83iMTSmLUMx7iW.jpg', '/4MEgBqv3gCU4LuEi1ej1VQvEtIZ.jpg', '#2C5F7A',
  'watching', 4, 2, 4, 10, 2,
  'The Matchmaker', 32,
  'returning', true, now() - interval '6 hours',
  'Hulu', 8.1, now() - interval '2 days', 3,
  array['Comedy', 'Mystery', 'Crime'], 2021, 0
) on conflict (user_id, content_id) do nothing;

-- 2. Severance — novo episódio disponível (3 dias atrás)
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, current_episode, total_seasons, total_episodes_season,
  episodes_watched, next_episode_name, next_episode_duration,
  series_status, new_episode_available, new_episode_available_since,
  streaming_platform, tmdb_rating, last_watched_at, sessions_last_7_days,
  genres, year, priority_score
) values (
  dev_user, 'tmdb-tv-95396', 'serie', 'Severance',
  '/lGQVhGzNLsQOJSiJnCOCMRuN5J9.jpg', '/ifUfE79O1raUwbaR6ij63IqPKEA.jpg', '#1A2744',
  'watching', 2, 5, 2, 10, 5,
  'Goodbye, Mrs. Selvig', 55,
  'returning', true, now() - interval '3 days',
  'Apple TV+', 8.7, now() - interval '3 days', 2,
  array['Drama', 'Mystery', 'Sci-Fi'], 2022, 0
) on conflict (user_id, content_id) do nothing;

-- 3. The Bear — último episódio da temporada (reta final: 1 ep)
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, current_episode, total_seasons, total_episodes_season,
  episodes_watched, next_episode_name, next_episode_duration,
  series_status, new_episode_available,
  streaming_platform, tmdb_rating, last_watched_at, sessions_last_7_days,
  genres, year, priority_score
) values (
  dev_user, 'tmdb-tv-136315', 'serie', 'The Bear',
  '/sHFlbKS3WLqMnp9t2ghADIJFnuQ.jpg', '/eTgFNNAp6MzI7b5mO9QLBK2Yxu6.jpg', '#3D1C0A',
  'watching', 3, 9, 3, 10, 9,
  'Forever', 58,
  'returning', false,
  'Hulu', 8.6, now() - interval '1 day', 4,
  array['Drama', 'Comedy'], 2022, 0
) on conflict (user_id, content_id) do nothing;

-- 4. Succession — reta final (3 eps restantes)
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, current_episode, total_seasons, total_episodes_season,
  episodes_watched, next_episode_name, next_episode_duration,
  series_status, new_episode_available,
  streaming_platform, tmdb_rating, last_watched_at, sessions_last_7_days,
  genres, year, priority_score
) values (
  dev_user, 'tmdb-tv-76479', 'serie', 'Succession',
  '/e2X8hvBDU8dPy4VCUaBBpXk1qU7.jpg', '/ik9LQzCfGVaxhXP7l8OiO5Uo9SB.jpg', '#1F1A14',
  'watching', 4, 7, 4, 10, 7,
  'Church and State', 63,
  'ended', false,
  'Max', 8.9, now() - interval '5 days', 2,
  array['Drama'], 2018, 0
) on conflict (user_id, content_id) do nothing;

-- 5. Hazbin Hotel — maratona ativa (is_marathon = true)
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, current_episode, total_seasons, total_episodes_season,
  episodes_watched, next_episode_name, next_episode_duration,
  series_status, new_episode_available, is_marathon,
  streaming_platform, tmdb_rating, last_watched_at, sessions_last_7_days,
  genres, year, priority_score
) values (
  dev_user, 'tmdb-tv-94954', 'serie', 'Hazbin Hotel',
  '/t9nyV3p2rBGjNI8u0RPFqZDUFhH.jpg', '/4qlEjzMi5cFJJKf7dEsBkFdBYaW.jpg', '#6B1630',
  'watching', 1, 5, 1, 8, 5,
  'Welcome to Heaven', 24,
  'returning', false, true,
  'Prime Video', 8.4, now() - interval '4 hours', 5,
  array['Animation', 'Comedy', 'Fantasy'], 2024, 0
) on conflict (user_id, content_id) do nothing;

-- 6. Oppenheimer — filme com progresso parcial (65%)
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, runtime, watch_progress_minutes,
  streaming_platform, streaming_available_since,
  tmdb_rating, last_watched_at, sessions_last_7_days,
  genres, year, priority_score
) values (
  dev_user, 'tmdb-movie-872585', 'filme', 'Oppenheimer',
  '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', '/rLb2cwF3Pazuxaj0sRXQ037tGI1.jpg', '#2A1810',
  'watching', 181, 118,
  'Netflix', now() - interval '10 days',
  8.1, now() - interval '6 days', 1,
  array['Drama', 'History', 'Thriller'], 2023, 0
) on conflict (user_id, content_id) do nothing;

-- 7. Duna: Parte 2 — filme na watchlist (zerado)
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, runtime, watch_progress_minutes,
  streaming_platform, streaming_available_since,
  tmdb_rating, added_to_watchlist_at,
  genres, year, rediscovery_eligible, priority_score
) values (
  dev_user, 'tmdb-movie-693134', 'filme', 'Duna: Parte Dois',
  '/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg', '/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg', '#8B6914',
  'watchlist', 167, 0,
  'Max', now() - interval '25 days',
  8.4, now() - interval '40 days',
  array['Adventure', 'Sci-Fi'], 2024, true, 0
) on conflict (user_id, content_id) do nothing;

-- 8. White Lotus S2 — paused
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, current_episode, total_seasons, total_episodes_season,
  episodes_watched, next_episode_name, next_episode_duration,
  series_status, new_episode_available,
  streaming_platform, tmdb_rating, last_watched_at, sessions_last_7_days,
  genres, year, priority_score
) values (
  dev_user, 'tmdb-tv-110316', 'serie', 'The White Lotus',
  '/mBbxu9wBfaTWg4TrFnRNDPcMOnP.jpg', '/xbSuFiJbbBWCkyCCKIMfuDCA4yV.jpg', '#D4A853',
  'paused', 2, 4, 3, 7, 4,
  'That''s Amore', 54,
  'returning', false,
  'Max', 8.1, now() - interval '20 days', 0,
  array['Drama', 'Mystery', 'Comedy'], 2021, 0
) on conflict (user_id, content_id) do nothing;

-- 9. Fleabag — paused
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, current_episode, total_seasons, total_episodes_season,
  episodes_watched, next_episode_name, next_episode_duration,
  series_status, new_episode_available,
  streaming_platform, tmdb_rating, last_watched_at, sessions_last_7_days,
  genres, year, priority_score
) values (
  dev_user, 'tmdb-tv-67070', 'serie', 'Fleabag',
  '/pZDMKNMnPKwLXYXxHmUE5eTjRCN.jpg', '/pZDMKNMnPKwLXYXxHmUE5eTjRCN.jpg', '#1C1C1C',
  'paused', 1, 3, 2, 6, 3,
  'Episode 4', 27,
  'ended', false,
  'Prime Video', 8.7, now() - interval '45 days', 0,
  array['Comedy', 'Drama'], 2016, 0
) on conflict (user_id, content_id) do nothing;

-- 10. Dark — abandoned
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, current_episode, total_seasons, total_episodes_season,
  episodes_watched, next_episode_name, next_episode_duration,
  series_status, new_episode_available,
  streaming_platform, tmdb_rating, last_watched_at, sessions_last_7_days,
  genres, year, rediscovery_eligible, priority_score
) values (
  dev_user, 'tmdb-tv-70523', 'serie', 'Dark',
  '/apbrbWs5M9n0dVsOhm3k5cQqBhp.jpg', '/FzPKEXlFsFP1M7XEIZLALX5NRq.jpg', '#0D1A2A',
  'abandoned', 2, 3, 3, 8, 3,
  'Abrahamson', 52,
  'ended', false,
  'Netflix', 8.8, now() - interval '90 days', 0,
  array['Drama', 'Mystery', 'Sci-Fi'], 2017, true, 0
) on conflict (user_id, content_id) do nothing;

-- 11. Abbott Elementary — watchlist (adicionada há 15 dias)
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, total_seasons, series_status, new_episode_available,
  streaming_platform, tmdb_rating, added_to_watchlist_at,
  genres, year, rediscovery_eligible, priority_score
) values (
  dev_user, 'tmdb-tv-129484', 'serie', 'Abbott Elementary',
  '/gRPBfPpMrHMrQHuqMnFsHVQHXJC.jpg', '/gRPBfPpMrHMrQHuqMnFsHVQHXJC.jpg', '#3B6EA5',
  'watchlist', null, 4, 'returning', false,
  'Hulu', 8.2, now() - interval '15 days',
  array['Comedy'], 2021, false, 0
) on conflict (user_id, content_id) do nothing;

-- 12. The Penguin — watchlist (adicionada há 7 dias)
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, total_seasons, series_status, new_episode_available,
  streaming_platform, streaming_available_since,
  tmdb_rating, added_to_watchlist_at,
  genres, year, rediscovery_eligible, priority_score
) values (
  dev_user, 'tmdb-tv-194764', 'serie', 'The Penguin',
  '/O9NIn6cFhUcaGUEDPBmSPGBNnq.jpg', '/uIFBfE4eEwKIpPKNbL2NLBerQBK.jpg', '#1A1A2E',
  'watchlist', null, 1, 'ended', false,
  'Max', now() - interval '7 days',
  8.5, now() - interval '7 days',
  array['Crime', 'Drama', 'Action'], 2024, false, 0
) on conflict (user_id, content_id) do nothing;

-- 13. Silo — watchlist (adicionada há 90 dias, candidata a redescoberta)
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, total_seasons, series_status, new_episode_available,
  streaming_platform, tmdb_rating, added_to_watchlist_at,
  genres, year, rediscovery_eligible, priority_score
) values (
  dev_user, 'tmdb-tv-125988', 'serie', 'Silo',
  '/7HS1VpABvCOfJbSHpTv4OFfBNx7.jpg', '/7HS1VpABvCOfJbSHpTv4OFfBNx7.jpg', '#5C4A32',
  'watchlist', null, 2, 'returning', false,
  'Apple TV+', 7.9, now() - interval '90 days',
  array['Drama', 'Sci-Fi'], 2023, true, 0
) on conflict (user_id, content_id) do nothing;

-- 14. Slow Horses — watching normal
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, current_episode, total_seasons, total_episodes_season,
  episodes_watched, next_episode_name, next_episode_duration,
  series_status, new_episode_available,
  streaming_platform, tmdb_rating, last_watched_at, sessions_last_7_days,
  genres, year, priority_score
) values (
  dev_user, 'tmdb-tv-99966', 'serie', 'Slow Horses',
  '/zjYtmHU5cAJ2x9GQGKXm35X5oHm.jpg', '/7ks1MIixv1PfHnwV1A7XYD9KXCG.jpg', '#2F3B2A',
  'watching', 4, 2, 4, 6, 2,
  'The Drops of God', 47,
  'returning', false,
  'Apple TV+', 8.1, now() - interval '8 days', 1,
  array['Thriller', 'Drama', 'Crime'], 2022, 0
) on conflict (user_id, content_id) do nothing;

-- 15. Andor — watching normal (sem assistir há bastante tempo)
insert into user_watching (
  user_id, content_id, content_type, title, poster_path, backdrop_path, dominant_color,
  status, current_season, current_episode, total_seasons, total_episodes_season,
  episodes_watched, next_episode_name, next_episode_duration,
  series_status, new_episode_available,
  streaming_platform, tmdb_rating, last_watched_at, sessions_last_7_days,
  genres, year, priority_score
) values (
  dev_user, 'tmdb-tv-83867', 'serie', 'Andor',
  '/59SVNzkEFAcHsV3VxVnHioRdTVH.jpg', '/1WVEMeNrRc7H3jl7QLGG0rrFPfY.jpg', '#1C2B3A',
  'watching', 2, 3, 2, 12, 3,
  'Who Are You?', 50,
  'returning', false,
  'Disney+', 8.4, now() - interval '22 days', 0,
  array['Sci-Fi', 'Drama', 'Action'], 2022, 0
) on conflict (user_id, content_id) do nothing;

end $$;

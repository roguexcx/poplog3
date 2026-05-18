-- Migration 013: função de cleanup periódico do cache TMDB + cron job
--
-- O banco free tier tem limite de 500 MB. As tabelas poplog3_titles,
-- title_external_ids, etc. acumulam metadados TMDB de qualquer título
-- que o usuário já pesquisou/visualizou, mesmo que remova da biblioteca.
-- Esta função remove tudo que não está em user_titles e roda semanalmente.

-- Habilita pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

GRANT USAGE ON SCHEMA cron TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- cleanup_orphaned_title_cache
-- Remove linhas de metadados TMDB que não têm nenhum título correspondente
-- na biblioteca dos usuários (user_titles). Mantém o banco dentro do limite
-- do free tier (~500 MB). Roda semanalmente via pg_cron.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_title_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_titles        int;
  v_deleted_ext_ids       int;
  v_deleted_availability  int;
  v_deleted_ratings       int;
  v_deleted_seasons       int;
  v_deleted_episodes      int;
BEGIN
  DELETE FROM poplog3_titles
    WHERE (tmdb_id, media_type) NOT IN (
      SELECT DISTINCT tmdb_id, media_type FROM user_titles
    );
  GET DIAGNOSTICS v_deleted_titles = ROW_COUNT;

  DELETE FROM title_external_ids
    WHERE (tmdb_id, media_type) NOT IN (
      SELECT DISTINCT tmdb_id, media_type FROM user_titles
    );
  GET DIAGNOSTICS v_deleted_ext_ids = ROW_COUNT;

  DELETE FROM poplog3_title_availability
    WHERE (tmdb_id, media_type) NOT IN (
      SELECT DISTINCT tmdb_id, media_type FROM user_titles
    );
  GET DIAGNOSTICS v_deleted_availability = ROW_COUNT;

  DELETE FROM title_ratings
    WHERE (tmdb_id, media_type) NOT IN (
      SELECT DISTINCT tmdb_id, media_type FROM user_titles
    );
  GET DIAGNOSTICS v_deleted_ratings = ROW_COUNT;

  DELETE FROM title_seasons
    WHERE series_tmdb_id NOT IN (
      SELECT DISTINCT tmdb_id FROM user_titles WHERE media_type = 'tv'
    );
  GET DIAGNOSTICS v_deleted_seasons = ROW_COUNT;

  DELETE FROM poplog3_episodes
    WHERE series_tmdb_id NOT IN (
      SELECT DISTINCT tmdb_id FROM user_titles WHERE media_type = 'tv'
    );
  GET DIAGNOSTICS v_deleted_episodes = ROW_COUNT;

  RAISE NOTICE 'cleanup_orphaned_title_cache: titles=%, ext_ids=%, availability=%, ratings=%, seasons=%, episodes=%',
    v_deleted_titles, v_deleted_ext_ids, v_deleted_availability,
    v_deleted_ratings, v_deleted_seasons, v_deleted_episodes;
END;
$$;

-- Agenda: toda sexta-feira às 03:00 UTC
SELECT cron.schedule(
  'cleanup-orphaned-title-cache',
  '0 3 * * 5',
  'SELECT public.cleanup_orphaned_title_cache()'
);

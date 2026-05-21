-- Migration 016: source_payload nullable em title_ratings
--
-- source_payload só existe quando veio uma resposta real do OMDb.
-- Nos paths de fallback (sem imdbId, OMDb falhou, só TMDB rating) o código
-- passa null, o que violava o NOT NULL e causava erro {} silencioso no upsert.
-- Tornamos nullable e dropamos o default desnecessário.

ALTER TABLE public.title_ratings
  ALTER COLUMN source_payload DROP NOT NULL,
  ALTER COLUMN source_payload DROP DEFAULT;

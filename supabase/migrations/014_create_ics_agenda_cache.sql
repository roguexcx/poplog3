-- Migration 014: cache da agenda ICS + enriquecimento TMDB
--
-- Guarda o resultado completo do pipeline (ICS parse → engine → TMDB enrich)
-- como um único blob JSONB. TTL de 24h — a route /api/ics/agenda lê daqui
-- primeiro; só re-executa o pipeline quando cached_at for anterior a 24h.
--
-- Uma única linha com id='main' é sempre mantida (upsert).
-- O payload inclui: groups, featuredGroups, secondaryGroups, stats,
-- trendingDay, trendingWeek, fetchedAt, source.

CREATE TABLE IF NOT EXISTS public.ics_agenda_cache (
  id          text        PRIMARY KEY DEFAULT 'main',
  payload     jsonb       NOT NULL,
  cached_at   timestamptz NOT NULL DEFAULT now()
);

-- Apenas o service role pode escrever; leitura pública (anon) permitida
-- para que a route GET possa ler sem precisar do service role.
ALTER TABLE public.ics_agenda_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read ics_agenda_cache"
  ON public.ics_agenda_cache
  FOR SELECT
  USING (true);

CREATE POLICY "service role write ics_agenda_cache"
  ON public.ics_agenda_cache
  FOR ALL
  USING (auth.role() = 'service_role');

-- Índice no cached_at para a query de staleness check ser rápida
CREATE INDEX IF NOT EXISTS ics_agenda_cache_cached_at_idx
  ON public.ics_agenda_cache (cached_at DESC);

-- Cron: invalida (deleta) o cache diariamente às 04:00 UTC para forçar
-- rebuild na próxima request. Assim o pipeline pesado roda uma vez por dia
-- e todos os usuários subsequentes recebem o cache quente.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.schedule(
  'invalidate-ics-agenda-cache',
  '0 4 * * *',
  $$DELETE FROM public.ics_agenda_cache WHERE id = 'main'$$
);

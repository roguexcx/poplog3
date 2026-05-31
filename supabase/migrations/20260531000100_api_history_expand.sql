-- ============================================================
-- POPLOG API History — Expandir engine_api_call_logs
-- ============================================================
-- Data: 2026-05-31
-- Objetivo:
--   1. Ampliar CHECK constraint para incluir Trakt, TheTVDB, Balloonerismm
--   2. Criar view diária e função de agregação por janela arbitrária
--   3. Política de retenção: manter 90 dias de logs raw, agregar o restante
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Expandir CHECK constraint de 'api'
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.engine_api_call_logs
  DROP CONSTRAINT IF EXISTS engine_api_call_logs_api_check;

ALTER TABLE public.engine_api_call_logs
  ADD CONSTRAINT engine_api_call_logs_api_check
  CHECK (api IN ('tmdb', 'omdb', 'watchmode', 'motn', 'trakt', 'tvdb', 'balloonerismm'));

-- Expandir fallback_from com mesma lista
ALTER TABLE public.engine_api_call_logs
  DROP CONSTRAINT IF EXISTS engine_api_call_logs_fallback_from_check;

ALTER TABLE public.engine_api_call_logs
  ADD CONSTRAINT engine_api_call_logs_fallback_from_check
  CHECK (fallback_from IN ('tmdb', 'omdb', 'watchmode', 'motn', 'trakt', 'tvdb', 'balloonerismm'));

-- ────────────────────────────────────────────────────────────
-- 2. Índice de cobertura para agregações diárias
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS engine_api_call_logs_api_day_idx
  ON public.engine_api_call_logs (api, date_trunc('day', ts), success, cache_status);

-- ────────────────────────────────────────────────────────────
-- 3. Tabela de agregados diários (para histórico de longo prazo)
--    Preenchida por função + scheduler. Permite consulta rápida
--    de semanas/meses sem escanear milhões de linhas raw.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_usage_daily (
  id           bigserial   PRIMARY KEY,
  day          date        NOT NULL,  -- dia UTC
  api          text        NOT NULL CHECK (api IN ('tmdb','omdb','watchmode','motn','trakt','tvdb','balloonerismm')),
  total_calls  integer     NOT NULL DEFAULT 0,
  cache_hits   integer     NOT NULL DEFAULT 0,
  errors       integer     NOT NULL DEFAULT 0,
  avg_ms       integer     NOT NULL DEFAULT 0,
  max_ms       integer     NOT NULL DEFAULT 0,
  p95_ms       integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS api_usage_daily_day_api_idx
  ON public.api_usage_daily (day, api);

ALTER TABLE public.api_usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_usage_daily_service_all"
  ON public.api_usage_daily FOR ALL
  USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- 4. Função: agregar dias completos de engine_api_call_logs
--    em api_usage_daily e remover logs raw com > 90 dias
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compact_api_call_logs(
  p_retain_days integer DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff_raw  date := current_date - p_retain_days;
  v_rows_upserted int := 0;
  v_rows_deleted  int := 0;
BEGIN
  -- Agrega dias completos ainda não compactados
  INSERT INTO public.api_usage_daily (day, api, total_calls, cache_hits, errors, avg_ms, max_ms, p95_ms, updated_at)
  SELECT
    date_trunc('day', ts)::date AS day,
    api,
    count(*)::int AS total_calls,
    count(*) FILTER (WHERE cache_status = 'hit')::int AS cache_hits,
    count(*) FILTER (WHERE NOT success)::int AS errors,
    coalesce(round(avg(duration_ms))::int, 0) AS avg_ms,
    coalesce(max(duration_ms), 0)::int AS max_ms,
    coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p95_ms,
    now()
  FROM public.engine_api_call_logs
  WHERE ts::date < v_cutoff_raw
  GROUP BY date_trunc('day', ts)::date, api
  ON CONFLICT (day, api) DO UPDATE
    SET total_calls = EXCLUDED.total_calls,
        cache_hits  = EXCLUDED.cache_hits,
        errors      = EXCLUDED.errors,
        avg_ms      = EXCLUDED.avg_ms,
        max_ms      = EXCLUDED.max_ms,
        p95_ms      = EXCLUDED.p95_ms,
        updated_at  = now();

  GET DIAGNOSTICS v_rows_upserted = ROW_COUNT;

  -- Remove logs raw antigos
  DELETE FROM public.engine_api_call_logs
  WHERE ts::date < v_cutoff_raw;

  GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'rows_upserted', v_rows_upserted,
    'rows_deleted',  v_rows_deleted,
    'cutoff',        v_cutoff_raw
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compact_api_call_logs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compact_api_call_logs(integer) TO service_role;

-- ────────────────────────────────────────────────────────────
-- 5. Função: histórico por API, janela arbitrária
--    Combina raw logs (últimos 90 dias) + daily aggregates (mais antigos)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.api_usage_history(
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH
api_list(api) AS (
  VALUES ('tmdb'),('omdb'),('watchmode'),('motn'),('trakt'),('tvdb'),('balloonerismm')
),
date_range AS (
  SELECT generate_series(
    current_date - p_days + 1,
    current_date,
    interval '1 day'
  )::date AS day
),
-- Dados dos últimos 90 dias (raw logs, agrupados por dia)
raw_agg AS (
  SELECT
    ts::date AS day,
    api,
    count(*)::int AS total_calls,
    count(*) FILTER (WHERE cache_status = 'hit')::int AS cache_hits,
    count(*) FILTER (WHERE NOT success)::int AS errors,
    coalesce(round(avg(duration_ms))::int, 0) AS avg_ms
  FROM public.engine_api_call_logs
  WHERE ts::date >= current_date - p_days
  GROUP BY ts::date, api
),
-- Dados históricos compactados (mais antigos que 90 dias)
hist_agg AS (
  SELECT day, api, total_calls, cache_hits, errors, avg_ms
  FROM public.api_usage_daily
  WHERE day >= current_date - p_days
    AND day < current_date - 89  -- evita sobreposição com raw
),
combined AS (
  SELECT * FROM raw_agg
  UNION ALL
  SELECT * FROM hist_agg
),
-- Totais por API (para o cabeçalho)
totals_by_api AS (
  SELECT
    a.api,
    coalesce(sum(c.total_calls), 0)::int AS total_calls,
    coalesce(sum(c.cache_hits), 0)::int AS cache_hits,
    coalesce(sum(c.errors), 0)::int AS errors,
    coalesce(round(avg(c.avg_ms))::int, 0) AS avg_ms
  FROM api_list a
  LEFT JOIN combined c ON c.api = a.api
  GROUP BY a.api
),
-- Série temporal: um objeto por dia com breakdown por API
daily_series AS (
  SELECT
    d.day,
    jsonb_object_agg(
      a.api,
      jsonb_build_object(
        'calls',    coalesce(c.total_calls, 0),
        'hits',     coalesce(c.cache_hits, 0),
        'errors',   coalesce(c.errors, 0),
        'avgMs',    coalesce(c.avg_ms, 0),
        'hitRate',  CASE WHEN coalesce(c.total_calls, 0) > 0
                      THEN round((coalesce(c.cache_hits,0)::numeric / c.total_calls)*100)::int
                      ELSE 0 END
      )
    ) AS apis
  FROM date_range d
  CROSS JOIN api_list a
  LEFT JOIN combined c ON c.day = d.day AND c.api = a.api
  GROUP BY d.day
  ORDER BY d.day DESC
)
SELECT jsonb_build_object(
  'window_days', p_days,
  'generated_at', now(),
  'totals', (
    SELECT jsonb_object_agg(
      api,
      jsonb_build_object(
        'totalCalls', total_calls,
        'cacheHits',  cache_hits,
        'errors',     errors,
        'avgMs',      avg_ms,
        'hitRate',    CASE WHEN total_calls > 0
                        THEN round((cache_hits::numeric / total_calls)*100)::int
                        ELSE 0 END
      )
    )
    FROM totals_by_api
    WHERE total_calls > 0
  ),
  'series', (SELECT jsonb_agg(jsonb_build_object('day', day, 'apis', apis)) FROM daily_series)
);
$$;

REVOKE ALL ON FUNCTION public.api_usage_history(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_usage_history(integer) TO service_role;

COMMENT ON TABLE public.api_usage_daily IS
  'Agregados diários de chamadas a APIs externas. '
  'Preenchido por compact_api_call_logs() — chamado manualmente ou via cron. '
  'Serve como fallback histórico quando logs raw são limpos após 90 dias.';

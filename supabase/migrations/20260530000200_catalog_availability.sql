-- ============================================================
-- POPLOG catalog_availability — Camada de providers regionais
-- ============================================================
-- Data: 2026-05-30
-- Referência: POPLOG_TMDB_REMOVAL_UNIFIED_FINAL_REVISADO — Seção 6
--
-- Substitui dependência de TMDB watch/providers.
-- Permite registrar disponibilidade de plataformas por região,
-- com fonte, confiança, data de verificação e validade do cache.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Tabela principal de disponibilidade
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog_availability (
  id                    bigserial   PRIMARY KEY,

  -- Identificação do título
  -- Preferir imdb_id ou trakt_id; tmdb_id apenas como fallback histórico
  imdb_id               text        DEFAULT NULL,
  trakt_id              bigint      DEFAULT NULL,
  tmdb_id               bigint      DEFAULT NULL,  -- legado, não usar como chave operacional
  media_type            text        NOT NULL CHECK (media_type IN ('movie', 'tv')),

  -- Provider
  provider_name         text        NOT NULL,
  provider_region       text        NOT NULL,       -- 'BR', 'US', etc. — nunca misturar regiões
  provider_type         text        NOT NULL CHECK (
    provider_type IN ('subscription', 'rent', 'buy', 'free', 'unknown')
  ),
  provider_url          text        DEFAULT NULL,
  provider_logo_url     text        DEFAULT NULL,

  -- Fonte e confiança
  source                text        NOT NULL CHECK (
    source IN ('balloonerismm', 'watchmode', 'motn', 'local', 'manual', 'future_provider')
  ),
  source_confidence     text        NOT NULL CHECK (
    source_confidence IN ('high', 'medium', 'low', 'predicted', 'stale', 'unverified')
  ),

  -- Validade
  checked_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,  -- providers mudam com frequência (1-7 dias)

  -- Auditoria
  evidence_payload_hash text        DEFAULT NULL,  -- hash do payload bruto para auditoria
  raw_payload_json      jsonb       DEFAULT NULL,   -- payload original compactado (opcional)

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 2. Índices de acesso frequente
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_catalog_availability_imdb_region
  ON catalog_availability (imdb_id, provider_region)
  WHERE imdb_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_availability_trakt_region
  ON catalog_availability (trakt_id, provider_region)
  WHERE trakt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_availability_expires
  ON catalog_availability (expires_at);

CREATE INDEX IF NOT EXISTS idx_catalog_availability_source
  ON catalog_availability (source, source_confidence);

-- ────────────────────────────────────────────────────────────
-- 3. Unique constraint: um provider/região por título
-- ────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_availability_unique_provider
  ON catalog_availability (
    COALESCE(imdb_id, ''),
    COALESCE(trakt_id::text, ''),
    provider_name,
    provider_region,
    provider_type
  );

-- ────────────────────────────────────────────────────────────
-- 4. Trigger de updated_at
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_catalog_availability_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER catalog_availability_updated_at
  BEFORE UPDATE ON catalog_availability
  FOR EACH ROW
  EXECUTE FUNCTION update_catalog_availability_updated_at();

-- ────────────────────────────────────────────────────────────
-- 5. RLS (Row Level Security)
-- ────────────────────────────────────────────────────────────

ALTER TABLE catalog_availability ENABLE ROW LEVEL SECURITY;

-- Leitura pública (dados de disponibilidade são públicos)
CREATE POLICY "catalog_availability_public_read"
  ON catalog_availability FOR SELECT
  USING (true);

-- Escrita apenas pelo service_role (jobs, adapters, admin)
CREATE POLICY "catalog_availability_service_write"
  ON catalog_availability FOR ALL
  USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- 6. Comentários de documentação
-- ────────────────────────────────────────────────────────────

COMMENT ON TABLE catalog_availability IS
  'Disponibilidade de títulos em plataformas de streaming por região. '
  'Fonte primária: Balloonerismm (IMDb-first) com validação e TTL. '
  'Nunca usar TMDB como fonte — campo tmdb_id existe apenas para migração histórica.';

COMMENT ON COLUMN catalog_availability.source_confidence IS
  'Nível de confiança: high=confirmado recente, medium=verificado, '
  'low=estimado, predicted=inferido, stale=expirado mas não removido, '
  'unverified=não confirmado pela fonte.';

COMMENT ON COLUMN catalog_availability.expires_at IS
  'Providers mudam com frequência. TTL recomendado: 1-7 dias. '
  'UI deve exibir aviso quando source_confidence = stale ou unverified.';

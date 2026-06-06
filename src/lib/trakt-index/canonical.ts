/**
 * Camada canônica do Trakt Index — versão, cache e reset centralizados.
 *
 * Todas as superfícies (HOME, "Em alta agora", Search) DEVEM usar
 * `getPoplogDailyTrendingIndex()` em vez de chamar `buildTraktIndex()` diretamente.
 * Isso garante que qualquer reset ou rotação de versão afete todos os pontos ao mesmo tempo.
 */

import { buildTraktIndex, isTraktIndexEnabled } from "./engine";
import type { TraktIndexItem } from "./types";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
  invalidateContinuitySectionCacheLocal,
} from "@/server/local-services/continuity-section-cache-local.service";

// ─── Versão do algoritmo ──────────────────────────────────────────────────────
/**
 * Incrementar este valor invalida todos os caches antigos, forçando reconstrução
 * a partir dos 7 sinais Trakt sem servir resultados do algoritmo anterior.
 */
export const POPLOG_TRENDING_ALGORITHM_VERSION = "trakt-7-signals-daily-v1";

// ─── Chaves de cache ──────────────────────────────────────────────────────────

/** Gera a chave versionada para o índice Trakt (inclui período e versão). */
export function traktIndexCacheKey(period = "daily"): string {
  return `trakt_index_top50_${period}_${POPLOG_TRENDING_ALGORITHM_VERSION}`;
}

/**
 * Chave legada (sem versão) — mantida apenas para invalidação proativa
 * ao fazer reset. Não deve ser usada para leitura.
 */
export const TRAKT_INDEX_LEGACY_CACHE_KEY = "trakt_index_top50_daily";

/** Chave do cache geral de trending da HOME (Balloonerismm/local DB). */
export const HOME_TRENDING_CACHE_KEY = "home_trending";

// ─── TTL ──────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60_000; // 30 min
const TRAKT_HTTP_TTL_SECONDS = 1_800;
const TRANSLATION_LIMIT = 24;

// ─── Payload do cache ─────────────────────────────────────────────────────────

type TraktIndexCachePayload = {
  results: TraktIndexItem[];
  period: string;
  algorithmVersion: string;
  generatedAt: string;
};

// ─── Função canônica ──────────────────────────────────────────────────────────

/**
 * Retorna o TOP 50 POPLOG calculado pelos 7 sinais Trakt para o período diário.
 * Lê do cache persistente (MySQL via Prisma) e grava se necessário.
 *
 * @param opts.fresh  true = ignora cache e reconstrói
 */
export async function getPoplogDailyTrendingIndex(opts: {
  fresh?: boolean;
} = {}): Promise<TraktIndexItem[]> {
  if (!isTraktIndexEnabled()) {
    console.warn("[trakt-canonical] Trakt Index disabled — returning []");
    return [];
  }

  const period = "daily";
  const cacheKey = traktIndexCacheKey(period);
  const startedAt = Date.now();

  // ── 1. Cache hit ─────────────────────────────────────────────────────────
  if (!opts.fresh) {
    const cached = await readContinuitySectionCache<TraktIndexCachePayload>(cacheKey, {
      region: "BR",
      language: "pt-BR",
    });

    if (
      cached?.payload.results?.length &&
      cached.status !== "stale" &&
      cached.payload.algorithmVersion === POPLOG_TRENDING_ALGORITHM_VERSION
    ) {
      console.log(
        "[trakt-canonical] cache=hit period=%s items=%d ms=%d",
        period, cached.payload.results.length, Date.now() - startedAt,
      );
      return cached.payload.results;
    }
  }

  // ── 2. Build fresco ───────────────────────────────────────────────────────
  console.log("[trakt-canonical] cache=miss building fresh period=%s", period);

  const results = await buildTraktIndex({
    period,
    limit: 50,
    translationLimit: TRANSLATION_LIMIT,
    ttlSeconds: TRAKT_HTTP_TTL_SECONDS,
  });

  if (results.length === 0) {
    console.warn("[trakt-canonical] build returned 0 items period=%s ms=%d", period, Date.now() - startedAt);
    return [];
  }

  const payload: TraktIndexCachePayload = {
    results,
    period,
    algorithmVersion: POPLOG_TRENDING_ALGORITHM_VERSION,
    generatedAt: new Date().toISOString(),
  };

  void writeContinuitySectionCache({
    sectionKey: cacheKey,
    region: "BR",
    language: "pt-BR",
    ttlMs: CACHE_TTL_MS,
    payload,
  });

  console.log(
    "[trakt-canonical] built period=%s items=%d ms=%d",
    period, results.length, Date.now() - startedAt,
  );

  return results;
}

// ─── Reset de caches ──────────────────────────────────────────────────────────

export type TrendingCacheResetOptions = {
  /**
   * Escopo de reset (para logs e rastreamento).
   * @default "trending-daily"
   */
  scope?: string;
  /**
   * Não remove dados de usuário (watchlist, histórico, avaliações).
   * Sempre true — a função não remove dados de usuário.
   */
  preserveUserData?: true;
  /** Invalida o cache persistente MySQL. @default true */
  includePersistentCache?: boolean;
  /** @deprecated Sem efeito — Next.js in-memory cache não tem API de invalidação por chave. Incluído para compatibilidade de assinatura. */
  includeMemoryCache?: boolean;
  /** @deprecated Sem efeito — `fetch` cache do Next.js não é gerenciável por código. Incluído para compatibilidade de assinatura. */
  includeNextFetchCache?: boolean;
};

export type TrendingCacheResetResult = {
  ok: boolean;
  scope: string;
  keysReset: string[];
  errors: string[];
  ms: number;
};

/**
 * Invalida todos os caches relacionados ao trending POPLOG.
 *
 * Reseta SOMENTE caches de conteúdo público — NUNCA dados de usuário
 * (histórico, watchlist, avaliações, progresso).
 *
 * Chaves invalidadas:
 *  - `trakt_index_top50_daily_<version>`  (índice versionado atual)
 *  - `trakt_index_top50_daily`            (chave legada sem versão)
 *  - `home_trending`                      (cache geral Balloonerismm/local DB)
 */
export async function resetPoplogTrendingCaches(
  opts: TrendingCacheResetOptions = {},
): Promise<TrendingCacheResetResult> {
  const {
    scope = "trending-daily",
    includePersistentCache = true,
  } = opts;

  const startedAt = Date.now();
  const keysReset: string[] = [];
  const errors: string[] = [];

  const keysToInvalidate = [
    traktIndexCacheKey("daily"),   // versioned key
    TRAKT_INDEX_LEGACY_CACHE_KEY,  // legacy key (no version)
    HOME_TRENDING_CACHE_KEY,       // home general cache
  ];

  console.log("[trakt-cache-reset] scope=%s keys=%j", scope, keysToInvalidate);

  if (includePersistentCache) {
    await Promise.allSettled(
      keysToInvalidate.map(async (key) => {
        const ok = await invalidateContinuitySectionCacheLocal({ sectionKey: key });
        if (ok) {
          keysReset.push(key);
          console.log("[trakt-cache-reset] invalidated sectionKey=%s", key);
        } else {
          errors.push(`invalidation returned false for sectionKey=${key}`);
          console.warn("[trakt-cache-reset] failed sectionKey=%s", key);
        }
      }),
    );
  }

  const ms = Date.now() - startedAt;
  const ok = errors.length === 0;

  console.log(
    "[trakt-cache-reset] done scope=%s ok=%s keysReset=%d errors=%d ms=%d",
    scope, ok, keysReset.length, errors.length, ms,
  );

  return { ok, scope, keysReset, errors, ms };
}

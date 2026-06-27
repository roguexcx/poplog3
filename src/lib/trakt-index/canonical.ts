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
  pickLocalized,
  normalizeCatalogLanguageStrict,
} from "@/lib/i18n/catalog-localization";
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
export const POPLOG_TRENDING_ALGORITHM_VERSION = "trakt-7-signals-daily-v2";

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

/** Chave do cache de trending REAL da HOME (com providers). */
export const HOME_TRENDING_CACHE_KEY = "home_trending";

/** Chave do cache de trending REAL leve da HOME/Hero (sem providers). */
export const HOME_TRENDING_LIGHT_CACHE_KEY = "home_trending_light";

/** Chave do cache de FALLBACK local (popularidade) — separada do trending real. */
export const HOME_TRENDING_LOCAL_CACHE_KEY = "home_trending_local";

/** Chave do cache de FALLBACK local leve (popularidade, sem providers). */
export const HOME_TRENDING_LOCAL_LIGHT_CACHE_KEY = "home_trending_local_light";

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
 * Projeta os campos legados (`title`/`overview`/`tagline`) para o idioma pedido
 * a partir do bloco `localized`, sem mutar o array cacheado (clona cada item).
 * `original_title` permanece sempre o original do Trakt.
 */
function projectIndexLanguage(
  items: TraktIndexItem[],
  language: string,
): TraktIndexItem[] {
  return items.map((item) => {
    const picked = pickLocalized(item.localized, language);
    return {
      ...item,
      title: picked.text.title ?? item.original_title ?? item.title,
      overview: picked.text.overview ?? item.overview,
      tagline: picked.text.tagline ?? item.tagline,
    };
  });
}

/**
 * Retorna o TOP 50 POPLOG calculado pelos 7 sinais Trakt para o período diário,
 * projetado para o idioma de catálogo pedido.
 *
 * O índice é a fonte da verdade BILÍNGUE: um único payload cacheado guarda
 * `localized` (pt-BR + en-US). A projeção por idioma acontece na leitura, então
 * o mesmo cache serve os dois idiomas sem contaminação (cada chamada recebe os
 * campos já no idioma pedido).
 *
 * @param opts.language  idioma de catálogo (pt-BR padrão)
 * @param opts.fresh     true = ignora cache e reconstrói
 * @param opts.peek      true = só lê cache (não reconstrói); cache frio → []
 */
export async function getPoplogDailyTrendingIndex(opts: {
  language?: string | null;
  fresh?: boolean;
  peek?: boolean;
} = {}): Promise<TraktIndexItem[]> {
  if (!isTraktIndexEnabled()) {
    if (!opts.peek) console.warn("[trakt-canonical] Trakt Index disabled — returning []");
    return [];
  }

  const period = "daily";
  const language = normalizeCatalogLanguageStrict(opts.language);
  const cacheKey = traktIndexCacheKey(period);
  const startedAt = Date.now();

  // ── 1. Cache hit (payload bilíngue, projetado para o idioma pedido) ────────
  if (!opts.fresh) {
    const cached = await readContinuitySectionCache<TraktIndexCachePayload>(cacheKey, {
      region: "BR",
      language: "bilingual",
    });

    if (
      cached?.payload.results?.length &&
      cached.status !== "stale" &&
      cached.payload.algorithmVersion === POPLOG_TRENDING_ALGORITHM_VERSION
    ) {
      console.log(
        "[trakt-canonical] cache=hit period=%s lang=%s items=%d ms=%d",
        period, language, cached.payload.results.length, Date.now() - startedAt,
      );
      return projectIndexLanguage(cached.payload.results, language);
    }
  }

  // Peek (caminho fast da Home): nunca reconstrói no caminho crítico.
  if (opts.peek) return [];

  // ── 2. Build fresco (bilíngue) ────────────────────────────────────────────
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
    language: "bilingual",
    ttlMs: CACHE_TTL_MS,
    payload,
  });

  console.log(
    "[trakt-canonical] built period=%s lang=%s items=%d ms=%d",
    period, language, results.length, Date.now() - startedAt,
  );

  return projectIndexLanguage(results, language);
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
 * Chaves invalidadas (todas as variações de idioma/região via wildcard):
 *  - `trakt_index_top50_daily_<version>`  (índice versionado atual, bilíngue)
 *  - `trakt_index_top50_daily`            (chave legada sem versão)
 *  - `home_trending` / `home_trending_light`         (trending REAL)
 *  - `home_trending_local` / `home_trending_local_light` (FALLBACK local)
 *
 * Limpa tanto o cache persistente (MySQL via Prisma) quanto o Redis, para que o
 * bump de versão/algoritmo reflita na Home na primeira request seguinte.
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
    traktIndexCacheKey("daily"),          // versioned bilingual index
    TRAKT_INDEX_LEGACY_CACHE_KEY,         // legacy key (no version)
    HOME_TRENDING_CACHE_KEY,              // real trending (providers)
    HOME_TRENDING_LIGHT_CACHE_KEY,        // real trending (light) — consumido pela Home/Hero
    HOME_TRENDING_LOCAL_CACHE_KEY,        // fallback local (providers)
    HOME_TRENDING_LOCAL_LIGHT_CACHE_KEY,  // fallback local (light)
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

    // Redis: a Home lê via camada de continuidade que prefere Redis, então o
    // reset precisa limpar TODAS as variações idioma/região de cada sectionKey.
    try {
      const { redisDeleteByPattern } = await import("@/server/cache/redis-client");
      await Promise.allSettled(
        keysToInvalidate.map((key) =>
          redisDeleteByPattern(`continuity:section:${encodeURIComponent(key)}:*`),
        ),
      );
    } catch (error) {
      errors.push(
        `redis pattern delete skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const ms = Date.now() - startedAt;
  const ok = errors.length === 0;

  console.log(
    "[trakt-cache-reset] done scope=%s ok=%s keysReset=%d errors=%d ms=%d",
    scope, ok, keysReset.length, errors.length, ms,
  );

  return { ok, scope, keysReset, errors, ms };
}

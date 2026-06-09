import type { CacheMeta } from "@/types/poplog-card";

/**
 * TTL padrão (em ms) para a janela stale: 3 dias após expiresAt.
 * Dados dentro dessa janela são servidos como stale + refresh em background.
 * Dados além dessa janela exigem refresh síncrono ou retorno de erro.
 */
const STALE_WINDOW_MS = 3 * 24 * 60 * 60 * 1_000;

type DbCacheFields = {
  cacheStatus?: string | null;
  lastFetchedAt?: Date | null;
  expiresAt?: Date | null;
  staleAt?: Date | null;
  source?: string | null;
  sourceVersion?: string | null;
};

/**
 * Deriva o `CacheMeta` canônico a partir de campos do banco de dados.
 *
 * Regras de status:
 *   missing  → nunca foi carregado (sem expiresAt ou lastFetchedAt)
 *   fresh    → now < expiresAt
 *   stale    → expiresAt ≤ now < staleAt  (servir + background refresh)
 *   expired  → now ≥ staleAt              (refresh síncrono necessário)
 */
export function resolveCacheMeta(row: DbCacheFields): CacheMeta {
  const now = Date.now();
  const expiresAt = row.expiresAt instanceof Date ? row.expiresAt : null;
  const staleAt =
    row.staleAt instanceof Date
      ? row.staleAt
      : expiresAt
        ? new Date(expiresAt.getTime() + STALE_WINDOW_MS)
        : null;

  let cacheStatus: CacheMeta["cacheStatus"];

  if (!expiresAt || !row.lastFetchedAt) {
    cacheStatus = "missing";
  } else if (now < expiresAt.getTime()) {
    cacheStatus = "fresh";
  } else if (staleAt && now < staleAt.getTime()) {
    cacheStatus = "stale";
  } else {
    cacheStatus = "expired";
  }

  const source = (row.source as "trakt" | "local") ?? "local";

  return {
    cacheStatus,
    lastFetchedAt: row.lastFetchedAt?.toISOString() ?? null,
    expiresAt: expiresAt?.toISOString() ?? null,
    staleAt: staleAt?.toISOString() ?? null,
    source,
    sourceVersion: row.sourceVersion ?? undefined,
  };
}

/**
 * Retorna true se o dado deve ser servido imediatamente (fresh ou stale)
 * e o refresh pode ser feito em background.
 */
export function shouldServeStale(meta: CacheMeta): boolean {
  return meta.cacheStatus === "stale";
}

/**
 * Retorna true se o dado está expirado e precisa de refresh síncrono.
 */
export function isExpiredOrMissing(meta: CacheMeta): boolean {
  return meta.cacheStatus === "expired" || meta.cacheStatus === "missing";
}

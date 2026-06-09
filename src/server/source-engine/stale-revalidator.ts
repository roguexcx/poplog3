import { enqueueCanonicalRefresh } from "./canonical-store";
import { resolveCacheMeta, shouldServeStale, isExpiredOrMissing } from "./cache-meta";
import {
  withRefreshLock,
  titleRefreshKey,
  sectionRefreshKey,
} from "@/server/cache-lock/refresh-lock";

type MediaType = "movie" | "tv";

type TitleCacheFields = {
  id: string;
  mediaType: MediaType;
  traktId?: bigint | number | null;
  imdbId?: string | null;
  slug?: string | null;
  cacheStatus?: string | null;
  lastFetchedAt?: Date | null;
  expiresAt?: Date | null;
  staleAt?: Date | null;
  source?: string | null;
  sourceVersion?: string | null;
};

/**
 * Verifica o status de cache de um título e dispara refresh em background se necessário.
 *
 * Regras:
 *   fresh   → não faz nada
 *   stale   → enfileira refresh em background (stale-while-revalidate)
 *   expired → enfileira refresh com prioridade alta
 *   missing → enfileira refresh com prioridade máxima
 *
 * O lock por chave garante que apenas um refresh seja enfileirado por vez,
 * mesmo que múltiplos usuários acessem o mesmo título simultaneamente.
 */
export async function maybeTriggerBackgroundRefresh(
  row: TitleCacheFields,
): Promise<void> {
  const meta = resolveCacheMeta(row);

  if (meta.cacheStatus === "fresh") return;

  const cacheKey = titleRefreshKey(row.mediaType, row.id);
  const kind = "title_detail";

  const priority =
    meta.cacheStatus === "missing"
      ? 10
      : meta.cacheStatus === "expired"
        ? 50
        : 100;

  void withRefreshLock(cacheKey, kind, async () => {
    await enqueueCanonicalRefresh({
      kind,
      mediaType: row.mediaType,
      poplogId: row.id,
      traktId: row.traktId != null ? String(row.traktId) : undefined,
      imdbId: row.imdbId ?? undefined,
      slug: row.slug ?? undefined,
      priority,
    });
  }).catch(() => null);
}

/**
 * Verifica se um dado de seção (home, radar, etc.) está stale e enfileira refresh.
 * Usa `withRefreshLock` para evitar stampede em seções de alta demanda.
 */
export async function maybeTriggerSectionRefresh(
  section: string,
  isStale: boolean,
): Promise<void> {
  if (!isStale) return;

  const cacheKey = sectionRefreshKey(section);
  const kind = "section_refresh";

  void withRefreshLock(cacheKey, kind, async () => {
    await enqueueCanonicalRefresh({
      kind,
      priority: 80,
    });
  }).catch(() => null);
}

export { resolveCacheMeta, shouldServeStale, isExpiredOrMissing };

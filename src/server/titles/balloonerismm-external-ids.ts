/**
 * Cross-reference IMDb ↔ TMDB via Balloonerismm.
 *
 * Usa a tabela title_external_ids existente (TitleExternalId no Prisma).
 * Nenhuma migration necessária — campos imdbId/tvdbId/traktId já existem.
 *
 * Feature flag: BALLOONERISMM_EXTERNAL_IDS_ENABLED=true
 * Quando false, todas as funções retornam null sem chamar a API.
 */

import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";
import type { BalloonerismExternalIds } from "@/server/api-clients/balloonerismm/types";
import {
  getExternalIdsCache,
  upsertExternalIdsCache,
} from "@/server/repositories/external-ids-cache.repository";
import { db } from "@/server/db/client";
import type { MediaType } from "@prisma/client";

// ─── Feature flag ─────────────────────────────────────────────────────────────

export function isExternalIdsEnabled(): boolean {
  const flag = process.env.BALLOONERISMM_EXTERNAL_IDS_ENABLED;
  if (!flag) return false;
  return flag !== "false" && flag !== "0";
}

// ─── Resolve IMDb ID a partir de tmdbId ───────────────────────────────────────

/**
 * Resolve o IMDb ID de um título a partir do tmdbId.
 *
 * Estratégia:
 *   1. Lê de title_external_ids (cache local, sem API call)
 *   2. Tenta extrair de Poplog3Title.tmdbPayload.external_ids (sem API call)
 *
 * Nunca chama API externa — apenas DB local.
 */
export async function resolveImdbIdForTitle(
  tmdbId: number,
  mediaType: MediaType,
): Promise<string | null> {
  // 1. Cache de external IDs
  const cached = await getExternalIdsCache(mediaType, tmdbId);
  if (cached?.imdbId) return cached.imdbId;

  // 2. tmdbPayload armazenado no Poplog3Title (sem API call extra)
  try {
    const row = await db.poplog3Title.findUnique({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
      select: { tmdbPayload: true },
    });
    if (row?.tmdbPayload) {
      const payload = row.tmdbPayload as Record<string, unknown>;
      const extIds = payload["external_ids"] as Record<string, unknown> | undefined;
      const imdbId = extIds?.["imdb_id"];
      if (typeof imdbId === "string" && imdbId.startsWith("tt")) {
        // Salva no cache para próximas consultas
        await upsertExternalIdsCache({ tmdbId, mediaType, imdbId }).catch(() => null);
        return imdbId;
      }
    }
  } catch {
    // silencia — não é crítico
  }

  return null;
}

// ─── Resolve TMDB ID a partir de IMDb ID ──────────────────────────────────────

/**
 * Resolve o tmdbId a partir de um IMDb ID.
 * Lê de title_external_ids — sem API call.
 *
 * Nota: não há índice dedicado em imdbId, mas é aceitável para debug/enrichment.
 */
export async function resolveTmdbIdFromImdbId(
  imdbId: string,
  mediaType: MediaType,
): Promise<number | null> {
  try {
    const row = await db.titleExternalId.findFirst({
      where: { imdbId, mediaType },
      select: { tmdbId: true },
    });
    return row?.tmdbId ?? null;
  } catch {
    return null;
  }
}

// ─── Resolve external IDs completos via Balloonerismm ─────────────────────────

export type ResolvedExternalIds = {
  tmdbId: number;
  mediaType: MediaType;
  imdbId: string | null;
  tvdbId: string | null;
  traktId: string | null;
  watchmodeId: number | null;
  motnId: string | null;
  /** True quando Balloonerismm foi chamado nesta resolução (não só cache). */
  fromApi: boolean;
};

/**
 * Resolve o conjunto completo de IDs externos para um título.
 *
 * Fluxo:
 *   1. Lê cache local (title_external_ids)
 *   2. Se IMDb ID ausente: tenta Poplog3Title.tmdbPayload
 *   3. Se BALLOONERISMM_EXTERNAL_IDS_ENABLED e IMDb ID resolvido:
 *      chama Balloonerismm /movie|tv/{imdbId}/external_ids
 *   4. Upsert dos resultados no cache
 */
export async function resolveExternalIdsForTitle(
  tmdbId: number,
  mediaType: MediaType,
): Promise<ResolvedExternalIds | null> {
  // 1. Cache local
  const cached = await getExternalIdsCache(mediaType, tmdbId);

  // 2. IMDb ID via Poplog3Title se ainda não temos
  let imdbId: string | null = cached?.imdbId ?? null;
  if (!imdbId) {
    imdbId = await resolveImdbIdForTitle(tmdbId, mediaType);
  }

  // 3. Balloonerismm enrichment
  let fromApi = false;
  let balloonerismData: BalloonerismExternalIds | null = null;

  if (isExternalIdsEnabled() && imdbId) {
    const bPath = mediaType === "movie"
      ? `/movie/${imdbId}/external_ids`
      : `/tv/${imdbId}/external_ids`;
    balloonerismData = await balloonerismGet<BalloonerismExternalIds>(bPath, {
      ttlSeconds: 604800, // 7 dias — IDs mudam raramente
    });
    if (balloonerismData) fromApi = true;
  }

  // 4. Merge e upsert
  const tvdbRaw = balloonerismData?.tvdb_id ?? cached?.tvdbId ?? null;
  const merged: ResolvedExternalIds = {
    tmdbId,
    mediaType,
    imdbId: balloonerismData?.imdb_id ?? imdbId,
    tvdbId: tvdbRaw !== null ? String(tvdbRaw) : null,
    traktId: cached?.traktId ?? null,
    watchmodeId: cached?.watchmodeId ?? null,
    motnId: cached?.motnId ?? null,
    fromApi,
  };

  if (merged.imdbId || merged.tvdbId) {
    await upsertExternalIdsCache({
      tmdbId,
      mediaType,
      imdbId: merged.imdbId,
      tvdbId: merged.tvdbId,
      traktId: merged.traktId,
      watchmodeId: merged.watchmodeId,
      motnId: merged.motnId,
    }).catch(() => null);
  }

  return merged;
}

// ─── Upsert direto (wrapper público) ─────────────────────────────────────────

/** Wrapper público ao repositório — para uso nos callers sem importar o repo diretamente. */
export async function upsertTitleExternalIds(input: {
  tmdbId: number;
  mediaType: MediaType;
  imdbId?: string | null;
  tvdbId?: string | null;
  traktId?: string | null;
  watchmodeId?: number | null;
  motnId?: string | null;
}): Promise<boolean> {
  return upsertExternalIdsCache(input);
}

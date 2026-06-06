import { db } from "@/server/db/client";
import type { MediaType } from "@prisma/client";
import { deleteCachedTitleRow } from "./title-cache.repository";
import { deleteExternalIdsCache, upsertExternalIdsCache } from "./external-ids-cache.repository";
import { isSyntheticTmdbId } from "@/lib/ids/synthetic-tmdb-id";

export type ConsolidationResult = {
  merged: boolean;
  reason: string;
  migratedUserTitles?: number;
  migratedUserState?: number;
  migratedFeedback?: number;
};

/**
 * Funde um row sintético (tmdbId negativo) com o row real (tmdbId positivo).
 *
 * O ID sintético é um artefato temporário derivado do imdbId quando o TMDB real
 * ainda não era conhecido. Quando ambos coexistem no banco, o sistema exibe o
 * mesmo título duas vezes e fragmenta dados de usuário entre dois IDs distintos.
 *
 * Esta função:
 *   1. Migra dados de usuário (biblioteca, estado, feedback, episódios) do ID
 *      sintético para o real, resolvendo conflitos de unicidade mantendo o dado real.
 *   2. Migra eventos e ratings (sem restrição única) diretamente.
 *   3. Apaga o row sintético de poplog3_titles e title_external_ids.
 *
 * É idempotente: chamar novamente quando o sintético já foi removido é seguro.
 */
export async function consolidateSyntheticToReal(
  syntheticTmdbId: number,
  realTmdbId: number,
  mediaType: MediaType,
): Promise<ConsolidationResult> {
  if (!isSyntheticTmdbId(syntheticTmdbId)) {
    return { merged: false, reason: "not_synthetic" };
  }
  if (realTmdbId <= 0) return { merged: false, reason: "not_real" };
  if (syntheticTmdbId === realTmdbId) return { merged: false, reason: "same_id" };

  try {
    let migratedUserTitles = 0;
    let migratedUserState = 0;
    let migratedFeedback = 0;

    // ── 1. user_titles — @@unique([userId, tmdbId, mediaType]) ──────────────
    const syntheticTitles = await db.userTitle.findMany({
      where: { tmdbId: syntheticTmdbId, mediaType },
      select: { userId: true, status: true, liked: true, favorite: true, rating: true, notes: true, startedAt: true, finishedAt: true, abandonedAt: true },
    });

    for (const entry of syntheticTitles) {
      const realExists = await db.userTitle.findUnique({
        where: { userId_tmdbId_mediaType: { userId: entry.userId, tmdbId: realTmdbId, mediaType } },
        select: { userId: true },
      });

      if (realExists) {
        await db.userTitle.delete({
          where: { userId_tmdbId_mediaType: { userId: entry.userId, tmdbId: syntheticTmdbId, mediaType } },
        });
      } else {
        await db.userTitle.update({
          where: { userId_tmdbId_mediaType: { userId: entry.userId, tmdbId: syntheticTmdbId, mediaType } },
          data: { tmdbId: realTmdbId },
        });
        migratedUserTitles++;
      }
    }

    // ── 2. user_title_state — @@unique([userId, tmdbId, mediaType]) ─────────
    const syntheticStates = await db.userTitleState.findMany({
      where: { tmdbId: syntheticTmdbId, mediaType },
      select: { id: true, userId: true },
    });

    for (const entry of syntheticStates) {
      const realExists = await db.userTitleState.findUnique({
        where: { userId_tmdbId_mediaType: { userId: entry.userId, tmdbId: realTmdbId, mediaType } },
        select: { id: true },
      });

      if (realExists) {
        await db.userTitleState.delete({ where: { id: entry.id } });
      } else {
        await db.userTitleState.update({
          where: { id: entry.id },
          data: { tmdbId: realTmdbId },
        });
        migratedUserState++;
      }
    }

    // ── 3. user_title_feedback — @@unique([userId, tmdbId, mediaType, feedbackType]) ──
    const syntheticFeedback = await db.userTitleFeedback.findMany({
      where: { tmdbId: syntheticTmdbId, mediaType },
      select: { id: true, userId: true, feedbackType: true },
    });

    for (const entry of syntheticFeedback) {
      const realExists = await db.userTitleFeedback.findFirst({
        where: { userId: entry.userId, tmdbId: realTmdbId, mediaType, feedbackType: entry.feedbackType },
        select: { id: true },
      });

      if (realExists) {
        await db.userTitleFeedback.delete({ where: { id: entry.id } });
      } else {
        await db.userTitleFeedback.update({
          where: { id: entry.id },
          data: { tmdbId: realTmdbId },
        });
        migratedFeedback++;
      }
    }

    // ── 4. user_events — sem restrição única em tmdbId, atualiza direto ──────
    await db.userEvent.updateMany({
      where: { tmdbId: syntheticTmdbId, mediaType },
      data: { tmdbId: realTmdbId },
    });

    // ── 5. user_ratings — sem restrição única em tmdbId ─────────────────────
    await db.userRating.updateMany({
      where: { tmdbId: syntheticTmdbId },
      data: { tmdbId: realTmdbId },
    });

    // ── 6. user_episodes (TV): seriesTmdbId ──────────────────────────────────
    if (mediaType === "tv") {
      await db.userEpisode.updateMany({
        where: { seriesTmdbId: syntheticTmdbId },
        data: { seriesTmdbId: realTmdbId },
      });

      // Seasons e episodes são cache: deleta os sintéticos para forçar re-fetch limpo
      // sob o ID real (migrar causaria conflitos se o real já tem as próprias seasons).
      await db.titleSeason.deleteMany({ where: { seriesTmdbId: syntheticTmdbId } });
      await db.poplog3Episode.deleteMany({ where: { seriesTmdbId: syntheticTmdbId } });
    }

    // ── 7. Garantir que o mapeamento imdbId → realTmdbId esteja em title_external_ids ──
    // Isso previne que futuras buscas pelo imdbId criem de novo o row sintético.
    const syntheticExternalIds = await db.titleExternalId.findUnique({
      where: { tmdbId_mediaType: { tmdbId: syntheticTmdbId, mediaType } },
    });
    if (syntheticExternalIds?.imdbId) {
      await upsertExternalIdsCache({
        tmdbId: realTmdbId,
        mediaType,
        imdbId: syntheticExternalIds.imdbId,
        tvdbId: syntheticExternalIds.tvdbId ?? undefined,
        traktId: syntheticExternalIds.traktId ?? undefined,
      });
    }

    // ── 8. Apagar rows sintéticos de cache ───────────────────────────────────
    await deleteExternalIdsCache(mediaType, syntheticTmdbId);
    await deleteCachedTitleRow(mediaType, syntheticTmdbId);

    console.info(
      `[title-consolidation] merged synthetic=${syntheticTmdbId} → real=${realTmdbId} ${mediaType}` +
      ` | userTitles=${migratedUserTitles} state=${migratedUserState} feedback=${migratedFeedback}`,
    );

    return { merged: true, reason: "ok", migratedUserTitles, migratedUserState, migratedFeedback };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[title-consolidation] failed", { syntheticTmdbId, realTmdbId, mediaType, error: msg });
    return { merged: false, reason: msg };
  }
}

/**
 * Encontra todos os pares (sintético, real) que coexistem no banco para o mesmo imdbId.
 * Usado pelo endpoint admin de limpeza bulk.
 */
export async function findSyntheticDuplicates(mediaType?: MediaType): Promise<
  Array<{ syntheticTmdbId: number; realTmdbId: number; mediaType: MediaType; imdbId: string }>
> {
  try {
    // Busca todos os rows sintéticos (tmdbId < 0) que têm um imdbId mapeado
    const syntheticExternalIds = await db.titleExternalId.findMany({
      where: {
        tmdbId: { lt: 0 },
        ...(mediaType ? { mediaType } : {}),
        imdbId: { not: null },
      },
      select: { tmdbId: true, mediaType: true, imdbId: true },
    });

    const results: Array<{ syntheticTmdbId: number; realTmdbId: number; mediaType: MediaType; imdbId: string }> = [];

    for (const row of syntheticExternalIds) {
      if (!row.imdbId) continue;

      // Procura o row real com o mesmo imdbId
      const realRow = await db.titleExternalId.findFirst({
        where: {
          tmdbId: { gt: 0 },
          mediaType: row.mediaType,
          imdbId: row.imdbId,
        },
        select: { tmdbId: true },
      });

      if (realRow) {
        results.push({
          syntheticTmdbId: row.tmdbId,
          realTmdbId: realRow.tmdbId,
          mediaType: row.mediaType,
          imdbId: row.imdbId,
        });
      }
    }

    // Também busca via tmdbPayload.imdb_id para rows sintéticos sem entry em title_external_ids
    const syntheticTitleRows = await db.poplog3Title.findMany({
      where: {
        tmdbId: { lt: 0 },
        ...(mediaType ? { mediaType } : {}),
      },
      select: { tmdbId: true, mediaType: true },
    });

    for (const row of syntheticTitleRows) {
      const alreadyFound = results.some((r) => r.syntheticTmdbId === row.tmdbId);
      if (alreadyFound) continue;

      // Deriva imdbId do sintético e procura real via payload
      const { imdbIdFromSyntheticTmdbId } = await import("@/lib/ids/synthetic-tmdb-id");
      const imdbId = imdbIdFromSyntheticTmdbId(row.tmdbId);
      if (!imdbId) continue;

      const realViaPayload = await db.poplog3Title.findFirst({
        where: {
          tmdbId: { gt: 0 },
          mediaType: row.mediaType,
          tmdbPayload: { path: "$.imdb_id", equals: imdbId },
        },
        select: { tmdbId: true },
      });

      if (realViaPayload) {
        results.push({
          syntheticTmdbId: row.tmdbId,
          realTmdbId: realViaPayload.tmdbId,
          mediaType: row.mediaType,
          imdbId,
        });
      }
    }

    return results;
  } catch (error) {
    console.error("[title-consolidation] findSyntheticDuplicates failed", error);
    return [];
  }
}

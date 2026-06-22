import { db } from "@/server/db/client";
import { hydrateManyTitleAvailability } from "@/server/availability";
import type { ProviderRegion } from "./provider-preferences";

/** Mapeia o tipo de oferta da camada global para o enum persistido em user_title_state. */
function toBestProviderType(type: string | null | undefined): string | null {
  if (!type) return null;
  return type === "streaming" ? "subscription" : type;
}

/**
 * Re-rankeia best_provider_* para todos os títulos ativos do usuário.
 * Chamado fire-and-forget quando o usuário muda suas preferências de streaming.
 *
 * Usa a camada GLOBAL de disponibilidade (Balloonerismm → cache → local), a mesma
 * fonte de verdade da Biblioteca/Home/Título — não há mais sync watchmode/MOTN aqui.
 */
export async function refreshAllUserTitleAvailability(
  userId: string,
  country: ProviderRegion,
): Promise<void> {
  const statesResult = await db.userTitleState.findMany({
    where: {
      userId,
      status: { not: null },
    },
    select: {
      tmdbId: true,
      mediaType: true,
    },
  });

  if (!statesResult.length) return;

  const region = country === "US" ? "US" : "BR";

  const summaries = await hydrateManyTitleAvailability(
    statesResult.map((row) => ({
      key: `${row.mediaType}:${row.tmdbId}`,
      input: {
        tmdbId: row.tmdbId,
        mediaType: row.mediaType as "movie" | "tv",
        region,
      },
    })),
    { concurrency: 6 },
  );

  for (const state of statesResult) {
    const summary = summaries.get(`${state.mediaType}:${state.tmdbId}`);
    const best = summary?.bestProvider ?? null;

    await db.userTitleState
      .upsert({
        where: {
          userId_tmdbId_mediaType: {
            userId,
            tmdbId: state.tmdbId,
            mediaType: state.mediaType as "movie" | "tv",
          },
        },
        update: {
          bestProviderName: best?.name ?? null,
          bestProviderType: toBestProviderType(best?.type),
          bestProviderLogo: best?.logoUrl ?? null,
        },
        create: {
          userId,
          tmdbId: state.tmdbId,
          mediaType: state.mediaType as "movie" | "tv",
          watchedKeys: [],
          bestProviderName: best?.name ?? null,
          bestProviderType: toBestProviderType(best?.type),
          bestProviderLogo: best?.logoUrl ?? null,
        },
      })
      .catch((error) => {
        console.error("[batch-availability-refresh] upsert failed", {
          tmdbId: state.tmdbId,
          error,
        });
      });
  }
}

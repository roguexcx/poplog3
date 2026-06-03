import { db } from "@/server/db/client";
import { getAvailabilityForDisplay } from "./title-availability";
import type { ProviderPreferenceInput, ProviderRegion } from "./provider-preferences";
import { getFavoriteTmdbProviderIds } from "@/server/local-services/streaming-preferences-local.service";

async function fetchPreferences(
  userId: string,
  country: ProviderRegion,
): Promise<ProviderPreferenceInput> {
  const favoriteProviderIds = await getFavoriteTmdbProviderIds({ userId, country });

  return {
    region: country,
    favoriteProviderIds: favoriteProviderIds.map((id) => String(id)),
    hiddenProviderIds: [],
    onlyFavorites: false,
  };
}

/**
 * Re-rankeia best_provider_* para todos os títulos ativos do usuário.
 * Chamado fire-and-forget quando o usuário muda suas preferências de streaming.
 */
export async function refreshAllUserTitleAvailability(
  userId: string,
  country: ProviderRegion,
): Promise<void> {
  const [preferences, statesResult] = await Promise.all([
    fetchPreferences(userId, country),
    db.userTitleState.findMany({
      where: {
        userId,
        status: { not: null },
      },
      select: {
        tmdbId: true,
        mediaType: true,
      },
    }),
  ]);

  const states = statesResult.map((row) => ({
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
  }));
  if (!states.length) return;

  for (const state of states) {
    const result = await getAvailabilityForDisplay({
      tmdbId: state.tmdb_id,
      mediaType: state.media_type as "movie" | "tv",
      preferences,
      contexts: ["library"],
      endpoint: "user_streaming_preferences",
    }).catch((error) => {
      console.error("[batch-availability-refresh] title availability failed", {
        tmdbId: state.tmdb_id,
        error,
      });
      return null;
    });

    const best =
      country === "US"
        ? result?.availability.regions.US.primaryProvider
        : result?.availability.primaryProvider;

    await db.userTitleState.upsert({
      where: {
        userId_tmdbId_mediaType: {
          userId,
          tmdbId: state.tmdb_id,
          mediaType: state.media_type as "movie" | "tv",
        },
      },
      update: {
        bestProviderName: best?.name ?? null,
        bestProviderType:
          best && "normalizedType" in best
            ? best.normalizedType
            : best?.type === "streaming"
              ? "subscription"
              : best?.type ?? null,
        bestProviderLogo: best?.logoUrl ?? null,
      },
      create: {
        userId,
        tmdbId: state.tmdb_id,
        mediaType: state.media_type as "movie" | "tv",
        watchedKeys: [],
        bestProviderName: best?.name ?? null,
        bestProviderType:
          best && "normalizedType" in best
            ? best.normalizedType
            : best?.type === "streaming"
              ? "subscription"
              : best?.type ?? null,
        bestProviderLogo: best?.logoUrl ?? null,
      },
    });
  }
}

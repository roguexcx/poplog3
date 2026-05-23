import { supabaseAdmin } from "@/server/supabase/admin";
import { getAvailabilityForDisplay } from "./title-availability";
import type { ProviderPreferenceInput, ProviderRegion } from "./provider-preferences";

async function fetchPreferencesAdmin(
  userId: string,
  country: ProviderRegion,
): Promise<ProviderPreferenceInput> {
  const { data: prefs } = await supabaseAdmin
    .from("user_streaming_preferences")
    .select("provider_id, priority_order")
    .eq("user_id", userId)
    .eq("country", country)
    .eq("is_enabled", true)
    .order("priority_order", { ascending: true });

  const rows = (prefs ?? []) as Array<{ provider_id: string; priority_order: number }>;

  if (!rows.length) {
    return { region: country, favoriteProviderIds: [], hiddenProviderIds: [], onlyFavorites: false };
  }

  const providerIds = rows.map((r) => r.provider_id);

  const { data: providerRows } = await supabaseAdmin
    .from("streaming_providers")
    .select("id, tmdb_provider_id")
    .in("id", providerIds);

  const providerMap = new Map(
    ((providerRows ?? []) as Array<{ id: string; tmdb_provider_id: number | null }>).map(
      (p) => [p.id, p.tmdb_provider_id],
    ),
  );

  const favoriteProviderIds = rows
    .map((r) => providerMap.get(r.provider_id))
    .filter((id): id is number => typeof id === "number")
    .map((id) => String(id));

  return { region: country, favoriteProviderIds, hiddenProviderIds: [], onlyFavorites: false };
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
    fetchPreferencesAdmin(userId, country),
    supabaseAdmin
      .from("user_title_state")
      .select("tmdb_id, media_type")
      .eq("user_id", userId)
      .not("status", "is", null),
  ]);

  const states = (statesResult.data ?? []) as Array<{ tmdb_id: number; media_type: string }>;
  if (!states.length) return;

  const now = new Date().toISOString();
  const updates: Array<Record<string, unknown>> = [];

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

    updates.push({
      user_id: userId,
      tmdb_id: state.tmdb_id,
      media_type: state.media_type,
      best_provider_name: best?.name ?? null,
      best_provider_type:
        best && "normalizedType" in best
          ? best.normalizedType
          : best?.type === "streaming"
            ? "subscription"
            : best?.type ?? null,
      best_provider_logo: best?.logoUrl ?? null,
      updated_at: now,
    });
  }

  if (!updates.length) return;

  const { error } = await supabaseAdmin
    .from("user_title_state")
    .upsert(updates, { onConflict: "user_id,tmdb_id,media_type" });

  if (error) {
    console.error("[batch-availability-refresh] upsert failed", error);
  }
}

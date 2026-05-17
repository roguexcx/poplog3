import { supabaseAdmin } from "@/server/supabase/admin";
import {
  buildAvailabilityProviders,
  getBestAvailabilityProvider,
} from "./availability-service";
import type { ProviderPreferenceInput, ProviderRegion } from "./provider-preferences";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

function tmdbImage(path: string | null | undefined, size: string): string | null {
  if (!path) return null;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${TMDB_IMAGE_BASE}/${size}${normalized}`;
}

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

  const titleIds = states.map((s) => s.tmdb_id);

  const { data: availRows } = await supabaseAdmin
    .from("poplog3_title_availability")
    .select(
      "tmdb_id, provider_name, provider_logo_path, availability_type, tmdb_provider_id, source, deep_link, quality, country",
    )
    .in("tmdb_id", titleIds)
    .eq("country", country);

  // Agrupa por tmdb_id
  const byTitle = new Map<number, Array<Record<string, unknown>>>();
  for (const row of (availRows ?? []) as Array<Record<string, unknown>>) {
    const key = row.tmdb_id as number;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key)!.push(row);
  }

  const now = new Date().toISOString();
  const updates: Array<Record<string, unknown>> = [];

  for (const state of states) {
    const rows = byTitle.get(state.tmdb_id) ?? [];

    const providers = buildAvailabilityProviders(
      rows.map((row) => ({
        name: row.provider_name as string,
        logoUrl: tmdbImage(row.provider_logo_path as string | null, "w92"),
        type: row.availability_type as string,
        deepLink: row.deep_link as string | null,
        quality: row.quality as string | null,
        country: row.country as string,
        source: row.source === "motn" ? "movieofthenight" : (row.source as string),
        providerId: (row.tmdb_provider_id as number | null) ?? 0,
        providerName: row.provider_name as string,
        logoPath: row.provider_logo_path as string | null,
        deeplink: row.deep_link as string | null,
      })) as never,
      { region: country, preferences },
    );

    const best = getBestAvailabilityProvider(providers);

    updates.push({
      user_id: userId,
      tmdb_id: state.tmdb_id,
      media_type: state.media_type,
      best_provider_name: best?.name ?? null,
      best_provider_type: best?.normalizedType ?? null,
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

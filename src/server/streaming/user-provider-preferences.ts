import { createSupabaseServerClient } from "@/server/supabase/server";

import type { ProviderPreferenceInput } from "./provider-preferences";

type UserStreamingPreferenceRow = {
  provider_id: string;
  priority_order: number;
  country: string;
};

type StreamingProviderRow = {
  id: string;
  tmdb_provider_id: number | null;
};

const FALLBACK: ProviderPreferenceInput = {
  region: "BR",
  favoriteProviderIds: [],
  hiddenProviderIds: [],
  onlyFavorites: false,
};

export async function getUserProviderPreferences(): Promise<ProviderPreferenceInput> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return FALLBACK;
  }

  const { data: preferenceRows, error: preferencesError } = await supabase
    .from("user_streaming_preferences")
    .select("provider_id, priority_order, country")
    .eq("user_id", user.id)
    .eq("is_enabled", true)
    .order("priority_order", { ascending: true });

  if (preferencesError) {
    console.error("[streaming preferences] preferences query failed", {
      message: preferencesError.message,
      details: preferencesError.details,
      hint: preferencesError.hint,
      code: preferencesError.code,
    });

    return FALLBACK;
  }

  const preferences = (preferenceRows ?? []) as UserStreamingPreferenceRow[];

  if (!preferences.length) {
    return FALLBACK;
  }

  const providerIds = preferences.map((row) => row.provider_id);

  const { data: providerRows, error: providersError } = await supabase
    .from("streaming_providers")
    .select("id, tmdb_provider_id")
    .in("id", providerIds);

  if (providersError) {
    console.error("[streaming preferences] providers query failed", {
      message: providersError.message,
      details: providersError.details,
      hint: providersError.hint,
      code: providersError.code,
    });

    return FALLBACK;
  }

  const providerMap = new Map(
    ((providerRows ?? []) as StreamingProviderRow[]).map((provider) => [
      provider.id,
      provider.tmdb_provider_id,
    ])
  );

  const favoriteProviderIds = preferences
  .map((preference) => providerMap.get(preference.provider_id))
  .filter((id): id is number => typeof id === "number")
  .map((id) => String(id));

  return {
    region: preferences[0]?.country === "US" ? "US" : "BR",
    favoriteProviderIds,
    hiddenProviderIds: [],
    onlyFavorites: false,
  };
}
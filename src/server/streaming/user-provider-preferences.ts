import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  getFavoriteTmdbProviderIds,
  getUserProviderDisplayPreferences as getDisplayPreferences,
} from "@/server/local-services/streaming-preferences-local.service";
import type { ProviderDisplayPreference } from "./provider-normalization";

import type { ProviderPreferenceInput } from "./provider-preferences";

const FALLBACK: ProviderPreferenceInput = {
  region: "BR",
  favoriteProviderIds: [],
  hiddenProviderIds: [],
  onlyFavorites: false,
  displayPreferences: [],
};

export async function getUserProviderPreferences(): Promise<ProviderPreferenceInput> {
  const user = await getCurrentUser();

  if (!user) {
    return FALLBACK;
  }

  const [favoriteProviderIds, displayPreferences] = await Promise.all([
    getFavoriteTmdbProviderIds({ userId: user.id }),
    getDisplayPreferences({ userId: user.id, country: "BR" }),
  ]);
  return {
    ...FALLBACK,
    favoriteProviderIds: favoriteProviderIds.map((id) => String(id)),
    displayPreferences,
  };
}

/** Leitura tolerante para o núcleo de availability (também roda fora de request). */
export async function getUserProviderDisplayPreferences(): Promise<ProviderDisplayPreference[]> {
  try {
    return (await getUserProviderPreferences()).displayPreferences ?? [];
  } catch {
    return [];
  }
}

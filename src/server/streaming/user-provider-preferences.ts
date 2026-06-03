import { getCurrentUser } from "@/server/auth/get-current-user";
import { getFavoriteTmdbProviderIds } from "@/server/local-services/streaming-preferences-local.service";

import type { ProviderPreferenceInput } from "./provider-preferences";

const FALLBACK: ProviderPreferenceInput = {
  region: "BR",
  favoriteProviderIds: [],
  hiddenProviderIds: [],
  onlyFavorites: false,
};

export async function getUserProviderPreferences(): Promise<ProviderPreferenceInput> {
  const user = await getCurrentUser();

  if (!user) {
    return FALLBACK;
  }

  const favoriteProviderIds = await getFavoriteTmdbProviderIds({ userId: user.id });
  return {
    ...FALLBACK,
    favoriteProviderIds: favoriteProviderIds.map((id) => String(id)),
  };
}

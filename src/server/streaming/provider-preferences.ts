import type { AvailabilityProvider } from "./availability-service";

export type ProviderRegion = "BR" | "US";

export type ProviderPreferenceInput = {
  favoriteProviderIds?: number[];
  hiddenProviderIds?: number[];
  region?: ProviderRegion;
  onlyFavorites?: boolean;
};

export type RankedAvailabilityProvider = AvailabilityProvider & {
  isFavorite: boolean;
  isHidden: boolean;
  preferenceRank: number;
};

const DEFAULT_REGION: ProviderRegion = "BR";

export function normalizeProviderPreferences(
  input?: ProviderPreferenceInput | null
): Required<ProviderPreferenceInput> {
  return {
    favoriteProviderIds: input?.favoriteProviderIds ?? [],
    hiddenProviderIds: input?.hiddenProviderIds ?? [],
    region: input?.region ?? DEFAULT_REGION,
    onlyFavorites: input?.onlyFavorites ?? false,
  };
}

export function rankAvailabilityProviders(
  providers: AvailabilityProvider[],
  preferences?: ProviderPreferenceInput | null
): RankedAvailabilityProvider[] {
  const normalized = normalizeProviderPreferences(preferences);

  const favoriteSet = new Set(normalized.favoriteProviderIds);
  const hiddenSet = new Set(normalized.hiddenProviderIds);

  return providers
    .map((provider) => {
      const favoriteIndex = normalized.favoriteProviderIds.indexOf(
        provider.providerId
      );

      const isFavorite = favoriteSet.has(provider.providerId);
      const isHidden = hiddenSet.has(provider.providerId);

      return {
        ...provider,
        isFavorite,
        isHidden,
        preferenceRank: isFavorite ? favoriteIndex : 9999,
      };
    })
    .filter((provider) => {
      if (provider.isHidden) return false;
      if (normalized.onlyFavorites && !provider.isFavorite) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1;
      }

      if (a.preferenceRank !== b.preferenceRank) {
        return a.preferenceRank - b.preferenceRank;
      }

      if (a.displayPriority !== b.displayPriority) {
        return a.displayPriority - b.displayPriority;
      }

      return a.providerName.localeCompare(b.providerName);
    });
}

export function hasFavoriteAvailability(
  providers: AvailabilityProvider[],
  preferences?: ProviderPreferenceInput | null
): boolean {
  const normalized = normalizeProviderPreferences(preferences);
  const favoriteSet = new Set(normalized.favoriteProviderIds);

  return providers.some((provider) => favoriteSet.has(provider.providerId));
}

export function getFavoriteAvailabilityProviders(
  providers: AvailabilityProvider[],
  preferences?: ProviderPreferenceInput | null
): RankedAvailabilityProvider[] {
  return rankAvailabilityProviders(providers, {
    ...preferences,
    onlyFavorites: true,
  });
}
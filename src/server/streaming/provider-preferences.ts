import type { AvailabilityProvider } from "./availability-service";

export type ProviderRegion = "BR" | "US";

export type ProviderPreferenceInput = {
  favoriteProviderIds?: string[];
  hiddenProviderIds?: string[];
  region?: ProviderRegion;
  onlyFavorites?: boolean;
};

export type RankedAvailabilityProvider = AvailabilityProvider & {
  isFavorite: boolean;
  isHidden: boolean;
  preferenceRank: number;
};

const DEFAULT_REGION: ProviderRegion = "BR";

function providerPreferenceKeys(provider: AvailabilityProvider): string[] {
  const record = provider as AvailabilityProvider & {
    providerId?: number | string | null;
    tmdbProviderId?: number | string | null;
    providerName?: string | null;
  };

  return [
    record.providerId,
    record.tmdbProviderId,
    record.providerName,
    provider.name,
  ]
    .filter((value): value is string | number => value !== null && value !== undefined)
    .map((value) => String(value));
}

function preferenceIndex(keys: string[], favorites: string[]) {
  for (const key of keys) {
    const index = favorites.indexOf(key);
    if (index >= 0) return index;
  }

  return -1;
}

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
      const keys = providerPreferenceKeys(provider);
      const favoriteIndex = preferenceIndex(keys, normalized.favoriteProviderIds);
      const hiddenIndex = preferenceIndex(keys, normalized.hiddenProviderIds);

      const isFavorite = favoriteIndex >= 0 || keys.some((key) => favoriteSet.has(key));
      const isHidden = hiddenIndex >= 0 || keys.some((key) => hiddenSet.has(key));

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

      return a.name.localeCompare(b.name);
    });
}

export function hasFavoriteAvailability(
  providers: AvailabilityProvider[],
  preferences?: ProviderPreferenceInput | null
): boolean {
  const normalized = normalizeProviderPreferences(preferences);
  const favoriteSet = new Set(normalized.favoriteProviderIds);

  return providers.some((provider) => favoriteSet.has(provider.name));
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

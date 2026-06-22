export type ProviderRegion = "BR" | "US";

export type ProviderPreferenceInput = {
  favoriteProviderIds?: string[];
  hiddenProviderIds?: string[];
  region?: ProviderRegion;
  onlyFavorites?: boolean;
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

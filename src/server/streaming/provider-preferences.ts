import type { ProviderDisplayPreference } from "./provider-normalization";
import { normalizeStreamingRegion, type StreamingRegion } from "./region";

export type ProviderRegion = StreamingRegion;

export type ProviderPreferenceInput = {
  favoriteProviderIds?: string[];
  hiddenProviderIds?: string[];
  region?: ProviderRegion;
  onlyFavorites?: boolean;
  /** Identidade raiz+variante usada pelo ranking visual global. */
  displayPreferences?: ProviderDisplayPreference[];
};

export function normalizeProviderPreferences(
  input?: ProviderPreferenceInput | null
): Required<ProviderPreferenceInput> {
  return {
    favoriteProviderIds: input?.favoriteProviderIds ?? [],
    hiddenProviderIds: input?.hiddenProviderIds ?? [],
    region: normalizeStreamingRegion(input?.region, {
      source: "provider-preferences",
      explicit: input?.region != null,
    }),
    onlyFavorites: input?.onlyFavorites ?? false,
    displayPreferences: input?.displayPreferences ?? [],
  };
}

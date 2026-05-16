import {
  buildAvailabilityProviders,
  type AvailabilityProvider,
} from "./availability-service";

import type { TitleProvider } from "@/features/title/types";

import type {
  ProviderPreferenceInput,
} from "./provider-preferences";

export interface ResolveAvailabilityInput {
  providers: TitleProvider[];
  region?: string;
  preferences?: ProviderPreferenceInput | null;
}

export interface ResolveAvailabilityResult {
  providers: AvailabilityProvider[];

  bestProvider: AvailabilityProvider | null;

  hasStreaming: boolean;

  hasFavoriteStreaming: boolean;

  favoriteProviders: AvailabilityProvider[];

  subscriptionProviders: AvailabilityProvider[];

  rentProviders: AvailabilityProvider[];

  buyProviders: AvailabilityProvider[];
}

export function resolveAvailability(
  input: ResolveAvailabilityInput,
): ResolveAvailabilityResult {
  const providers =
    buildAvailabilityProviders(
      input.providers,
      {
        region: input.region,
        preferences:
          input.preferences ?? undefined,
      },
    );

  const subscriptionProviders =
    providers.filter(
      (provider) =>
        provider.normalizedType ===
        "subscription",
    );

  const rentProviders =
    providers.filter(
      (provider) =>
        provider.normalizedType ===
        "rent",
    );

  const buyProviders =
    providers.filter(
      (provider) =>
        provider.normalizedType ===
        "buy",
    );

  const favoriteProviders =
    providers.filter(
      (provider) =>
        provider.isPreferred,
    );

  return {
    providers,

    bestProvider:
      providers[0] ?? null,

    hasStreaming:
      subscriptionProviders.length > 0,

    hasFavoriteStreaming:
      favoriteProviders.length > 0,

    favoriteProviders,

    subscriptionProviders,

    rentProviders,

    buyProviders,
  };
}
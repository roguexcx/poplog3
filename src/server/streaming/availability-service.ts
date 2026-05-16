import type { TitleProvider } from "@/features/title/types";

import {
  rankAvailabilityProviders,
  type ProviderPreferenceInput,
} from "./provider-preferences";

export type AvailabilitySource =
  | "tmdb"
  | "watchmode"
  | "movieofthenight";

export type ProviderConfidence =
  | "tmdb_only"
  | "watchmode_confirmed"
  | "movieofthenight_confirmed"
  | "mixed_confirmed"
  | "predicted_window"
  | "user_relevant_confirmed";

export type AvailabilityStatus =
  | "unavailable"
  | "cinema"
  | "upcoming"
  | "available_subscription"
  | "available_rent"
  | "available_buy"
  | "available_pvod"
  | "leaving_soon"
  | "leaving_this_week"
  | "leaving_this_month"
  | "expired";

export type AvailabilityType =
  | "subscription"
  | "rent"
  | "buy"
  | "free"
  | "ads";

export interface AvailabilityProvider extends TitleProvider {
  region: string;
  availabilityStatus: AvailabilityStatus;
  confidence: ProviderConfidence;
  normalizedType: AvailabilityType;
  priorityScore: number;
  isPreferred?: boolean;
  isLeavingSoon?: boolean;
}

export interface BuildAvailabilityOptions {
  region?: string;
  preferences?: ProviderPreferenceInput;
}

const PROVIDER_TYPE_PRIORITY: Record<string, number> = {
  subscription: 100,
  free: 90,
  ads: 80,
  rent: 70,
  buy: 60,
};

const SOURCE_CONFIDENCE_PRIORITY: Record<
  ProviderConfidence,
  number
> = {
  mixed_confirmed: 100,
  user_relevant_confirmed: 95,
  watchmode_confirmed: 90,
  movieofthenight_confirmed: 85,
  tmdb_only: 70,
  predicted_window: 40,
};

export function normalizeAvailabilityType(
  type?: string,
): AvailabilityType {
  switch (type) {
    case "flatrate":
    case "subscription":
      return "subscription";

    case "free":
      return "free";

    case "ads":
      return "ads";

    case "rent":
      return "rent";

    case "buy":
      return "buy";

    default:
      return "subscription";
  }
}

export function normalizeAvailabilityTypeOrNull(
  type?: string | null,
): AvailabilityType | null {
  switch (type) {
    case "flatrate":
    case "subscription":
      return "subscription";

    case "free":
      return "free";

    case "ads":
      return "ads";

    case "rent":
      return "rent";

    case "buy":
      return "buy";

    default:
      return null;
  }
}

function normalizeAvailabilityStatus(
  type: AvailabilityType,
): AvailabilityStatus {
  switch (type) {
    case "subscription":
      return "available_subscription";

    case "rent":
      return "available_rent";

    case "buy":
      return "available_buy";

    case "free":
    case "ads":
      return "available_subscription";

    default:
      return "upcoming";
  }
}

export function resolveProviderConfidence(
  source?: string | null,
): ProviderConfidence {
  switch (source) {
    case "watchmode":
      return "watchmode_confirmed";

    case "movieofthenight":
      return "movieofthenight_confirmed";

    case "mixed":
      return "mixed_confirmed";

    case "predicted":
      return "predicted_window";

    case "user_relevant":
      return "user_relevant_confirmed";

    case "tmdb":
    default:
      return "tmdb_only";
  }
}

function buildPriorityScore(
  provider: AvailabilityProvider,
): number {
  let score = 0;

  score +=
    PROVIDER_TYPE_PRIORITY[
      provider.normalizedType
    ] ?? 0;

  score +=
    SOURCE_CONFIDENCE_PRIORITY[
      provider.confidence
    ] ?? 0;

  if (provider.isPreferred) {
    score += 1000;
  }

  if (provider.isLeavingSoon) {
    score += 150;
  }

  return score;
}

function dedupeProviders(
  providers: AvailabilityProvider[],
): AvailabilityProvider[] {
  const map = new Map<
    string,
    AvailabilityProvider
  >();

  for (const provider of providers) {
    const key = [
      provider.providerId,
      provider.normalizedType,
      provider.region,
    ].join("-");

    const existing = map.get(key);

    if (!existing) {
      map.set(key, provider);
      continue;
    }

    if (
      provider.priorityScore >
      existing.priorityScore
    ) {
      map.set(key, provider);
    }
  }

  return Array.from(map.values());
}

export function buildAvailabilityProviders(
  providers: TitleProvider[],
  options: BuildAvailabilityOptions = {},
): AvailabilityProvider[] {
  const {
    region = "BR",
    preferences,
  } = options;

  const normalized =
    providers.map<AvailabilityProvider>(
      (provider) => {
        const normalizedType =
          normalizeAvailabilityType(
            provider.type,
          );

        const confidence =
          resolveProviderConfidence(
            provider.source,
          );

        const availabilityProvider: AvailabilityProvider =
          {
            ...provider,
            region,
            normalizedType,
            confidence,
            availabilityStatus:
              normalizeAvailabilityStatus(
                normalizedType,
              ),
            priorityScore: 0,
          };

        return availabilityProvider;
      },
    );

  const deduped =
    dedupeProviders(normalized);

  const ranked =
    rankAvailabilityProviders(
      deduped,
      preferences,
    );

  return ranked
    .map((provider) => {
      const availabilityProvider: AvailabilityProvider =
        {
          ...provider,
          isPreferred:
            provider.isFavorite,
        };

      availabilityProvider.priorityScore =
        buildPriorityScore(
          availabilityProvider,
        );

      return availabilityProvider;
    })
    .sort(
      (a, b) =>
        b.priorityScore -
        a.priorityScore,
    );
}

export function groupAvailabilityProviders(
  providers: AvailabilityProvider[],
) {
  return {
    subscription: providers.filter(
      (provider) =>
        provider.normalizedType ===
        "subscription",
    ),

    free: providers.filter(
      (provider) =>
        provider.normalizedType ===
        "free",
    ),

    ads: providers.filter(
      (provider) =>
        provider.normalizedType ===
        "ads",
    ),

    rent: providers.filter(
      (provider) =>
        provider.normalizedType ===
        "rent",
    ),

    buy: providers.filter(
      (provider) =>
        provider.normalizedType ===
        "buy",
    ),
  };
}

export function getBestAvailabilityProvider(
  providers: AvailabilityProvider[],
) {
  if (!providers.length) {
    return null;
  }

  return [...providers].sort(
    (a, b) =>
      b.priorityScore -
      a.priorityScore,
  )[0];
}
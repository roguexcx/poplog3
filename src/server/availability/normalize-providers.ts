/**
 * Normalização de providers para a camada global de disponibilidade.
 *
 * Agrupa uma lista plana de `TitleProvider[]` no formato JustWatch/TMDB
 * (flatrate/rent/buy/free/ads) e deriva as flags de status de availability.
 */

import type { TitleProvider } from "@/features/title/types";
import {
  EMPTY_GROUPED_PROVIDERS,
  type AvailabilityStatus,
  type GroupedProviders,
} from "./availability-types";

/** Agrupa providers planos por tipo de oferta. */
export function groupProviders(providers: TitleProvider[]): GroupedProviders {
  if (!providers.length) return { ...EMPTY_GROUPED_PROVIDERS };

  const grouped: GroupedProviders = {
    flatrate: [],
    rent: [],
    buy: [],
    free: [],
    ads: [],
  };

  for (const p of providers) {
    switch (p.type) {
      case "streaming":
        grouped.flatrate.push(p);
        break;
      case "rent":
        grouped.rent.push(p);
        break;
      case "buy":
        grouped.buy.push(p);
        break;
      case "free":
        grouped.free.push(p);
        break;
      case "ads":
        grouped.ads.push(p);
        break;
      default:
        // Tipo desconhecido — trata como streaming (oferta principal)
        grouped.flatrate.push(p);
    }
  }

  return grouped;
}

/**
 * Melhor provider para exibição compacta (1 logo no card).
 * Prioridade: flatrate > free > ads > rent > buy.
 */
export function pickBestProvider(
  grouped: GroupedProviders,
  hasPreferences = false,
): TitleProvider | null {
  if (hasPreferences) {
    const ranked = [
      ...grouped.flatrate,
      ...grouped.free,
      ...grouped.ads,
      ...grouped.rent,
      ...grouped.buy,
    ].sort((left, right) => {
      if (Boolean(left.isExactPreference) !== Boolean(right.isExactPreference)) {
        return left.isExactPreference ? -1 : 1;
      }
      if (Boolean(left.isPreferred) !== Boolean(right.isPreferred)) {
        return left.isPreferred ? -1 : 1;
      }
      return (left.preferenceOrder ?? 1_000) - (right.preferenceOrder ?? 1_000);
    });
    const personalized = ranked.find((provider) => provider.isPreferred);
    if (personalized) return personalized;
  }
  return (
    grouped.flatrate[0] ??
    grouped.free[0] ??
    grouped.ads[0] ??
    grouped.rent[0] ??
    grouped.buy[0] ??
    null
  );
}

/**
 * Deriva as flags de status a partir dos providers agrupados + sinais temporais.
 *
 * `isInTheaters` e `isFutureRelease` vêm da detecção de release dates (theatrical)
 * e são injetados pelo caller; aqui combinamos com os providers para o estado final.
 */
export function deriveStatus(input: {
  grouped: GroupedProviders;
  isInTheaters?: boolean;
  isFutureRelease?: boolean;
}): AvailabilityStatus {
  const { grouped } = input;

  const hasStreaming = grouped.flatrate.length > 0 || grouped.free.length > 0 || grouped.ads.length > 0;
  const hasRent = grouped.rent.length > 0;
  const hasBuy = grouped.buy.length > 0;
  const isAvailableSomewhere = hasStreaming || hasRent || hasBuy;

  const isInTheaters = Boolean(input.isInTheaters) && !hasStreaming;
  const isFutureRelease = Boolean(input.isFutureRelease) && !isAvailableSomewhere;

  return {
    hasStreaming,
    hasRent,
    hasBuy,
    isAvailableSomewhere,
    isInTheaters,
    isFutureRelease,
    isUnavailable: !isAvailableSomewhere && !isInTheaters && !isFutureRelease,
  };
}

/** Conta total de providers em todos os grupos. */
export function countProviders(grouped: GroupedProviders): number {
  return (
    grouped.flatrate.length +
    grouped.rent.length +
    grouped.buy.length +
    grouped.free.length +
    grouped.ads.length
  );
}

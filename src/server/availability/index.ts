/**
 * Camada global de disponibilidade (Onde Assistir).
 *
 * Ponto único de import para todo o site. Qualquer card/lista/grid que exiba um
 * título consome `getTitleAvailability` (server) ou recebe `availability` no payload.
 * Nenhum componente client chama a API externa diretamente.
 */

export {
  getTitleAvailability,
  getTitleAvailabilityWithDebug,
  hydrateTitleAvailability,
  hydrateManyTitleAvailability,
  resolveTitleProviders,
  emptyAvailabilitySummary,
  type AvailabilityDebug,
} from "./availability-service";

export {
  groupProviders,
  deriveStatus,
  pickBestProvider,
  countProviders,
} from "./normalize-providers";

export {
  detectReleaseStatus,
  getBalloonerismReleaseDates,
  THEATRICAL_WINDOW_DAYS,
} from "./release-status";

export type {
  TitleAvailabilitySummary,
  AvailabilityStatus,
  AvailabilityState,
  GroupedProviders,
  AvailabilityIdInput,
  AvailabilitySource,
  AvailabilityRegion,
} from "./availability-types";

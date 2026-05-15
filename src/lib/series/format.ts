import type {
  MovieState,
  SeriesState,
  TitleAvailabilityState,
} from "./types";

import type { StatusBadgeVariant } from "@/components/ui/StatusBadge";

/**
 * Label PT-BR canônico para cada estado de série.
 */
const SERIES_LABEL: Record<SeriesState, string> = {
  "coming-soon": "Em breve",
  "episode-available": "Novo episódio",
  "in-season": "Em temporada",
  "awaiting-next-season": "Aguardando temporada",
  finished: "Finalizada",
  unknown: "—",
};

const MOVIE_LABEL: Record<MovieState, string> = {
  "coming-soon": "Em breve",
  released: "Lançado",
  unknown: "—",
};

export function formatSeriesState(state: SeriesState): string {
  return SERIES_LABEL[state];
}

export function formatMovieState(state: MovieState): string {
  return MOVIE_LABEL[state];
}

export function formatAvailabilityState(
  state: TitleAvailabilityState
): string {
  if (state === "released") return MOVIE_LABEL.released;
  return SERIES_LABEL[state as SeriesState] ?? "—";
}

/**
 * Mapeia o estado canônico para o variant da `StatusBadge`. Isso garante
 * que toda a UI use a mesma paleta para o mesmo estado lógico.
 */
const SERIES_TO_BADGE: Record<SeriesState, StatusBadgeVariant> = {
  "coming-soon": "coming-soon",
  "episode-available": "new-episode",
  "in-season": "in-season",
  "awaiting-next-season": "neutral",
  finished: "finished",
  unknown: "neutral",
};

const MOVIE_TO_BADGE: Record<MovieState, StatusBadgeVariant> = {
  "coming-soon": "coming-soon",
  released: "neutral",
  unknown: "neutral",
};

export function seriesStateToBadgeVariant(
  state: SeriesState
): StatusBadgeVariant {
  return SERIES_TO_BADGE[state];
}

export function movieStateToBadgeVariant(
  state: MovieState
): StatusBadgeVariant {
  return MOVIE_TO_BADGE[state];
}

export function availabilityStateToBadgeVariant(
  state: TitleAvailabilityState
): StatusBadgeVariant {
  if (state === "released") return "neutral";
  return SERIES_TO_BADGE[state as SeriesState] ?? "neutral";
}

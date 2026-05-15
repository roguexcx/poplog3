/**
 * Ponto único de import da camada de estado de séries/filmes da POPLOG.
 *
 * Uso:
 *
 *   import {
 *     seriesStateFromTitle,
 *     availabilityStateFromTitle,
 *     formatSeriesState,
 *     seriesStateToBadgeVariant,
 *   } from "@/lib/series";
 *
 * NUNCA acesse `tmdb_payload.status` ou `next_episode_to_air` diretamente nas
 * telas — sempre passe pelas funções daqui. Centralizar a regra global
 * é o único jeito de evitar que três telas decidam diferente.
 */
export * from "./types";
export * from "./series-state";
export * from "./format";

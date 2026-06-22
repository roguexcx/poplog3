/**
 * library-coming-soon.ts — ADAPTADOR fino da Biblioteca para a regra canônica.
 *
 * A Biblioteca NÃO decide "Em breve" por conta própria nem consulta providers:
 * apenas extrai os summaries normalizados (BR + US) do item e delega aos resolvers
 * canônicos (`@/server/availability/coming-soon`), que consomem o fluxo
 *   catalog_availability → getTitleAvailability/hydrateManyTitleAvailability → front-end.
 */

import type { Poplog3UserLibraryItem } from "@/server/library/library-service";
import {
  resolveComingSoon,
  resolveTheatricalStatus,
  THEATRICAL_VOD_WINDOW_DAYS,
  THEATRICAL_SAFE_FALLBACK_DAYS,
  type ComingSoonInfo,
  type ComingSoonPhase,
  type TheatricalDisplay,
} from "@/server/availability/coming-soon";

export { THEATRICAL_VOD_WINDOW_DAYS, THEATRICAL_SAFE_FALLBACK_DAYS };
export type { ComingSoonInfo, ComingSoonPhase, TheatricalDisplay };

function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > 0 ? time : null;
}

/** Data de lançamento confirmada do item (filme: release_date; série: first_air_date). */
export function getConfirmedReleaseDate(item: Poplog3UserLibraryItem): string | null {
  const raw =
    item.media_type === "tv"
      ? item.title?.first_air_date ?? item.title?.release_date
      : item.title?.release_date ?? item.title?.first_air_date;
  return timestamp(raw) !== null ? raw ?? null : null;
}

/**
 * Decisão de "Em breve" para um item da Biblioteca — mero adaptador sobre a regra
 * canônica. Prioridade BR → US → fallback é aplicada dentro de `resolveComingSoon`.
 */
export function getComingSoonInfo(
  item: Poplog3UserLibraryItem,
  now = Date.now(),
): ComingSoonInfo {
  return resolveComingSoon(
    {
      mediaType: item.media_type,
      availabilityBR: item.availability,
      availabilityUS: item.availability_us,
      confirmedReleaseDate: getConfirmedReleaseDate(item),
    },
    now,
  );
}

/**
 * Estado "Nos cinemas" para um item da Biblioteca — adaptador sobre a regra canônica.
 * Tem prioridade de rótulo sobre "Aguardando VOD" enquanto não houver digital no BR.
 */
export function getTheatricalStatus(
  item: Poplog3UserLibraryItem,
  now = Date.now(),
): TheatricalDisplay {
  return resolveTheatricalStatus(
    {
      mediaType: item.media_type,
      availabilityBR: item.availability,
      availabilityUS: item.availability_us,
      confirmedReleaseDate: getConfirmedReleaseDate(item),
    },
    now,
  );
}

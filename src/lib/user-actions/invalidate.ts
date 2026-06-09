"use client";

import { notifyUserTitlesUpdated } from "@/hooks/useTitleToggle";
import {
  dispatchSeriesProgressRefresh,
  dispatchLibraryStatusChanged,
} from "@/features/title/episodeProgressClient";

/**
 * Escopo de invalidação — controla quais seções são notificadas.
 *
 * Ao executar uma ação de usuário, passe os escopos afetados.
 * Isso evita que cada componente implemente sua própria chamada a
 * `router.refresh()` ou `window.dispatchEvent(...)`.
 */
export type InvalidationScope =
  | "library"
  | "title_state"
  | "episodes"
  | "for_you"
  | "recommendations"
  | "watchlist"
  | "acompanhando"
  | "home"
  | "radar"
  | "sorteio";

type InvalidateOptions = {
  scopes: InvalidationScope[];
  /** Para escopo "episodes" e "acompanhando": tmdbId da série. */
  seriesTmdbId?: number;
  /** Status de biblioteca após a ação. */
  newStatus?: string;
};

/**
 * Dispara as invalidações necessárias após uma ação do usuário.
 *
 * Centraliza o que antes era feito em cada componente com calls espalhadas
 * de `router.refresh()`, `notifyUserTitlesUpdated()`, `dispatchSeriesProgressRefresh()`.
 *
 * Apenas os eventos relevantes são disparados — sem over-invalidation.
 */
export function invalidateUserContent({
  scopes,
  seriesTmdbId,
  newStatus,
}: InvalidateOptions): void {
  if (typeof window === "undefined") return;

  const scopeSet = new Set(scopes);

  // Biblioteca e estado geral
  if (
    scopeSet.has("library") ||
    scopeSet.has("title_state") ||
    scopeSet.has("watchlist") ||
    scopeSet.has("for_you") ||
    scopeSet.has("home")
  ) {
    notifyUserTitlesUpdated();
  }

  // Progresso de série (Acompanhando, TitleActions, EpisodeBrowser)
  if ((scopeSet.has("episodes") || scopeSet.has("acompanhando")) && seriesTmdbId) {
    dispatchSeriesProgressRefresh(seriesTmdbId);
    if (newStatus) {
      dispatchLibraryStatusChanged(seriesTmdbId, newStatus);
    }
  }

  // Seções específicas — futuros ouvintes podem escutar esses eventos
  if (scopeSet.has("recommendations")) {
    window.dispatchEvent(new CustomEvent("poplog:recommendations-changed"));
  }

  if (scopeSet.has("radar")) {
    window.dispatchEvent(new CustomEvent("poplog:radar-changed"));
  }

  if (scopeSet.has("sorteio")) {
    window.dispatchEvent(new CustomEvent("poplog:sorteio-changed"));
  }
}

/**
 * Atalho para invalidar tudo após uma ação genérica de usuário.
 * Use quando não tiver certeza do escopo ou quando a ação afeta múltiplas seções.
 */
export function invalidateAll(seriesTmdbId?: number, newStatus?: string): void {
  invalidateUserContent({
    scopes: ["library", "title_state", "for_you", "watchlist", "acompanhando", "home"],
    seriesTmdbId,
    newStatus,
  });
}

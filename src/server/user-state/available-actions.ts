import type {
  UserAvailableAction,
  PoplogUserState,
  PoplogLibraryStatus,
} from "@/types/poplog-card";
import type { UserTitleState } from "@/server/state/user-title-state";

type MediaType = "movie" | "tv";

/**
 * Computa as ações disponíveis para um título dado seu estado atual e tipo de mídia.
 *
 * O frontend renderiza botões e menus APENAS a partir desta lista.
 * Regras de negócio ficam aqui — nunca nos componentes.
 */
export function computeAvailableActions(
  mediaType: MediaType,
  state: UserTitleState | null,
): UserAvailableAction[] {
  if (!state) {
    return ["addToWatchlist", "markAsWatched", "favorite"];
  }

  const status = state.status;
  const isFavorite = Boolean(state.favorite);
  const computedState = state.computed_state;
  const actions: UserAvailableAction[] = [];

  // ── Watchlist ────────────────────────────────────────────────────────────────
  if (status === "watchlist") {
    actions.push("removeFromWatchlist");
  } else if (!status || (!["watched", "abandoned"].includes(status ?? ""))) {
    // Não mostra "adicionar à watchlist" se já está em watchlist, assistido ou abandonado
    if (status !== "watchlist" && status !== "watching") {
      actions.push("addToWatchlist");
    }
  }

  // ── Assistido / não assistido ─────────────────────────────────────────────────
  if (mediaType === "movie") {
    if (status === "watched" || computedState === "watched" || computedState === "completed") {
      actions.push("markAsUnwatched");
    } else {
      actions.push("markAsWatched");
    }
  } else {
    // Séries: "marcar como visto" = marcar todos os episódios ao ar
    if (computedState === "completed" || computedState === "up_to_date") {
      actions.push("markAsUnwatched");
    } else if (computedState !== "abandoned") {
      actions.push("markAsWatched");
    }
  }

  // ── Favorito ──────────────────────────────────────────────────────────────────
  if (isFavorite) {
    actions.push("unfavorite");
  } else {
    actions.push("favorite");
  }

  // ── Pause / resume ────────────────────────────────────────────────────────────
  if (mediaType === "tv") {
    if (status === "watching" || computedState === "in_progress" || computedState === "up_to_date") {
      actions.push("pause");
    }
    if (status === "abandoned" || computedState === "abandoned") {
      actions.push("resume");
    }
  }

  // ── Drop (abandonar) ──────────────────────────────────────────────────────────
  if (status !== "abandoned" && status !== null && status !== "watchlist") {
    actions.push("drop");
  }

  // ── Remover da biblioteca ─────────────────────────────────────────────────────
  if (status) {
    actions.push("removeFromLibrary");
  }

  return actions;
}

/**
 * Deriva o `PoplogLibraryStatus` semântico a partir do status bruto de biblioteca
 * e do estado computado.
 */
function deriveLibraryStatus(
  status: string | null,
  isFavorite: boolean,
  computedState: string | null,
): PoplogLibraryStatus {
  if (!status) return null;
  if (isFavorite && (status === "watched" || computedState === "completed")) {
    return "favorite";
  }
  if (status === "abandoned") return "dropped";
  if (status === "watchlist") return "watchlist";
  if (status === "watching") return "watching";
  if (status === "watched") return "watched";
  if (status === "fridge") return "paused";
  return null;
}

/**
 * Constrói um `PoplogUserState` canônico a partir de um `UserTitleState` do banco.
 *
 * Esta é a função central que transforma o estado materializado do servidor
 * no contrato que o frontend consome.
 */
export function buildUserStateForCard(
  mediaType: MediaType,
  state: UserTitleState | null,
  isAuthenticated: boolean,
): PoplogUserState {
  if (!isAuthenticated) {
    return {
      inLibrary: false,
      status: null,
      isFavorite: false,
      isWatched: false,
      isInWatchlist: false,
      isDropped: false,
      availableActions: ["addToWatchlist", "markAsWatched", "favorite"],
      isAuthenticated: false,
    };
  }

  if (!state) {
    return {
      inLibrary: false,
      status: null,
      isFavorite: false,
      isWatched: false,
      isInWatchlist: false,
      isDropped: false,
      availableActions: ["addToWatchlist", "markAsWatched", "favorite"],
      isAuthenticated: true,
    };
  }

  const isFavorite = Boolean(state.favorite);
  const isWatched =
    state.status === "watched" ||
    state.computed_state === "watched" ||
    state.computed_state === "completed" ||
    state.computed_state === "up_to_date";
  const isInWatchlist = state.status === "watchlist";
  const isDropped = state.status === "abandoned";
  const libraryStatus = deriveLibraryStatus(state.status, isFavorite, state.computed_state);

  const progressPercent =
    typeof state.progress_pct === "number" && state.progress_pct > 0
      ? Math.round(state.progress_pct)
      : undefined;

  const nextEpisode =
    state.next_season !== null && state.next_episode !== null
      ? {
          seasonNumber: state.next_season,
          episodeNumber: state.next_episode,
          airDate: state.next_episode_air_date ?? undefined,
        }
      : null;

  return {
    inLibrary: Boolean(state.status),
    status: libraryStatus,
    isFavorite,
    isWatched,
    isInWatchlist,
    isDropped,
    progressPercent,
    nextEpisode,
    availableActions: computeAvailableActions(mediaType, state),
    isAuthenticated: true,
    computedState: state.computed_state,
  };
}

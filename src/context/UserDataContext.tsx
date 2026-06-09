"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
} from "react";

import { useAuth } from "@/hooks/useAuth";
import { useUserStatesStore } from "@/stores/user-states-store";
import type { UserTitle } from "@/types/user";
import type { PoplogUserState } from "@/types/poplog-card";

type State = {
  titles: UserTitle[];
  loading: boolean;
};

type Action =
  | { type: "LOADING" }
  | { type: "LOADED"; titles: UserTitle[] }
  | { type: "CLEAR" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "LOADING":
      return { ...state, loading: true };
    case "LOADED":
      return { titles: action.titles, loading: false };
    case "CLEAR":
      return { titles: [], loading: false };
  }
}

type ContextValue = {
  titles: UserTitle[];
  loading: boolean;
  userId: string;
  refresh: () => void;
};

const UserDataContext = createContext<ContextValue | null>(null);

export function useUserData(): ContextValue {
  const ctx = useContext(UserDataContext);
  if (!ctx) throw new Error("useUserData must be used inside <UserDataProvider>");
  return ctx;
}

export function useOptionalUserData(): ContextValue | null {
  return useContext(UserDataContext);
}

/** Converte um `UserTitle` da biblioteca em `PoplogUserState` para o Zustand store. */
function userTitleToState(title: UserTitle): PoplogUserState {
  const isFavorite = Boolean(title.favorite);
  const isWatched = title.status === "watched";
  const isInWatchlist = title.status === "watchlist";
  const isDropped = title.status === "abandoned";
  const isWatching = title.status === "watching";

  const availableActions: PoplogUserState["availableActions"] = [];

  if (isInWatchlist) {
    availableActions.push("removeFromWatchlist");
  } else if (!isWatched && !isDropped) {
    availableActions.push("addToWatchlist");
  }

  if (isWatched) {
    availableActions.push("markAsUnwatched");
  } else {
    availableActions.push("markAsWatched");
  }

  if (isFavorite) {
    availableActions.push("unfavorite");
  } else {
    availableActions.push("favorite");
  }

  if (isWatching) {
    availableActions.push("pause", "drop");
  } else if (isDropped) {
    availableActions.push("resume");
  } else if (!isInWatchlist && title.status) {
    availableActions.push("drop");
  }

  if (title.status) {
    availableActions.push("removeFromLibrary");
  }

  return {
    inLibrary: Boolean(title.status),
    status: isInWatchlist
      ? "watchlist"
      : isWatching
        ? "watching"
        : isWatched
          ? isFavorite ? "favorite" : "watched"
          : isDropped
            ? "dropped"
            : null,
    isFavorite,
    isWatched,
    isInWatchlist,
    isDropped,
    availableActions,
    isAuthenticated: true,
  };
}

type ProviderProps = {
  userId: string;
  children: React.ReactNode;
};

export function UserDataProvider({ userId, children }: ProviderProps) {
  const [state, dispatch] = useReducer(reducer, { titles: [], loading: true });
  const { setUserStates, clearUserStates } = useUserStatesStore();

  const load = useCallback(async () => {
    const response = await fetch("/api/library", { cache: "no-store" });

    if (!response.ok) {
      console.error("UserDataContext: erro ao carregar títulos:", response.status);
      dispatch({ type: "CLEAR" });
      clearUserStates();
      return;
    }

    const json = (await response.json()) as { data?: UserTitle[] };
    const titles = json.data ?? [];
    dispatch({ type: "LOADED", titles });

    // Popula o Zustand store com os estados de usuário.
    // Indexado por poplogId (CUID) quando disponível, e também por
    // "tmdb:{tmdbId}:{mediaType}" para cards sem poplogId real (coleções, etc.)
    const stateMap: Record<string, PoplogUserState> = {};
    for (const title of titles) {
      const state = userTitleToState(title);
      const poplogId = title.poplogId ? String(title.poplogId) : null;
      if (poplogId) stateMap[poplogId] = state;
      if (title.tmdb_id && title.media_type) {
        stateMap[`tmdb:${title.tmdb_id}:${title.media_type}`] = state;
      }
    }
    setUserStates(stateMap);
  }, [clearUserStates, setUserStates]);

  useEffect(() => {
    dispatch({ type: "LOADING" });
    load();

    function onMutation() {
      load();
    }

    window.addEventListener("poplog:user-titles-updated", onMutation);
    return () => window.removeEventListener("poplog:user-titles-updated", onMutation);
  }, [load]);

  return (
    <UserDataContext.Provider
      value={{ titles: state.titles, loading: state.loading, userId, refresh: load }}
    >
      {children}
    </UserDataContext.Provider>
  );
}

export function UserDataAutoProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading || !user) {
    return (
      <UserDataContext.Provider value={null}>
        {children}
      </UserDataContext.Provider>
    );
  }

  return <UserDataProvider userId={user.id}>{children}</UserDataProvider>;
}

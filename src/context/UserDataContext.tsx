"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
} from "react";

import type { UserTitle } from "@/types/user";

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

type ProviderProps = {
  userId: string;
  children: React.ReactNode;
};

export function UserDataProvider({ userId, children }: ProviderProps) {
  const [state, dispatch] = useReducer(reducer, { titles: [], loading: true });

  const load = useCallback(async () => {
    const response = await fetch("/api/library", { cache: "no-store" });

    if (!response.ok) {
      console.error("UserDataContext: erro ao carregar títulos:", response.status);
      dispatch({ type: "CLEAR" });
      return;
    }

    const json = (await response.json()) as { data?: UserTitle[] };
    dispatch({ type: "LOADED", titles: json.data ?? [] });
  }, [userId]);

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

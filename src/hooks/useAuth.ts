"use client";

import { useEffect, useState } from "react";
import type { AuthUser } from "@/server/auth/types";

type Session = {
  user: AuthUser;
} | null;

type AuthState = {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  isLoggedIn: boolean;
  authjsConfigured: boolean;
  refresh: () => Promise<void>;
};

type CurrentResponse = {
  user: AuthUser | null;
  auth?: {
    local?: boolean;
    authjsConfigured?: boolean;
  };
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    isLoggedIn: false,
    authjsConfigured: false,
    refresh: async () => {},
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/auth/current", { cache: "no-store" });
        const json = (await response.json()) as CurrentResponse;
        if (cancelled) return;
        const user = json.user ?? null;
        setState({
          user,
          session: user ? { user } : null,
          loading: false,
          isLoggedIn: !!user,
          authjsConfigured: json.auth?.authjsConfigured ?? false,
          refresh: load,
        });
      } catch {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            user: null,
            session: null,
            loading: false,
            isLoggedIn: false,
            authjsConfigured: false,
          }));
        }
      }
    }

    setState((current) => ({ ...current, refresh: load }));
    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

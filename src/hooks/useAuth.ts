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
  refresh: () => Promise<void>;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    isLoggedIn: false,
    refresh: async () => {},
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const response = await fetch("/api/auth/current", { cache: "no-store" });
      const json = (await response.json()) as { user: AuthUser | null };
      if (cancelled) return;
      const user = json.user ?? null;
      setState({
        user,
        session: user ? { user } : null,
        loading: false,
        isLoggedIn: !!user,
        refresh: load,
      });
    }

    setState((current) => ({ ...current, refresh: load }));
    load().catch(() => {
      if (!cancelled) {
        setState((current) => ({
          ...current,
          user: null,
          session: null,
          loading: false,
          isLoggedIn: false,
        }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

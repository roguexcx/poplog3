"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuthUser } from "@/server/auth/types";

type Session = { user: AuthUser } | null;

export type AuthState = {
  user: AuthUser | null;
  session: Session;
  loading: boolean;
  isLoggedIn: boolean;
  authjsConfigured: boolean;
  refresh: () => Promise<void>;
};

type CurrentResponse = {
  user?: AuthUser | null;
  auth?: { local?: boolean; authjsConfigured?: boolean };
};

// ─── Module-level singleton ───────────────────────────────────────────────────
// Shared across ALL useAuth() instances — one /api/auth/current call per page load.
// Without this, each component (Sidebar, UserDataContext, HomeMemberSections, etc.)
// would independently fetch auth, causing 7+ concurrent requests on every render.

let _user: AuthUser | null = null;
let _loading = true;
let _authjsConfigured = false;
let _fetchPromise: Promise<void> | null = null;
const _subscribers = new Set<() => void>();

function _notify() {
  _subscribers.forEach((fn) => fn());
}

async function _fetchAuth() {
  try {
    const res = await fetch("/api/auth/current", { cache: "no-store" });
    const json = (await res.json()) as CurrentResponse;
    _user = json.user ?? null;
    _authjsConfigured = json.auth?.authjsConfigured ?? false;
  } catch {
    _user = null;
    _authjsConfigured = false;
  } finally {
    _loading = false;
    _fetchPromise = null;
    _notify();
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState {
  const [, tick] = useState(0);
  const rerender = useCallback(() => tick((n) => n + 1), []);

  useEffect(() => {
    _subscribers.add(rerender);

    if (_loading) {
      // Initiate fetch only once; subsequent mounts reuse the in-flight promise
      if (!_fetchPromise) {
        _fetchPromise = _fetchAuth();
      }
    } else {
      // Data already fetched before this component mounted — sync immediately
      rerender();
    }

    return () => {
      _subscribers.delete(rerender);
    };
  }, [rerender]);

  const refresh = useCallback(async () => {
    _loading = true;
    _notify();
    _fetchPromise = _fetchAuth();
    await _fetchPromise;
  }, []);

  return {
    user: _user,
    session: _user ? { user: _user } : null,
    loading: _loading,
    isLoggedIn: !!_user,
    authjsConfigured: _authjsConfigured,
    refresh,
  };
}

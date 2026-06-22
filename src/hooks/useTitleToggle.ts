"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

/** Dispara o evento global que faz o UserDataContext recarregar. */
export function notifyUserTitlesUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("poplog:user-titles-updated"));
}

type TitleToggleConfig<T> = {
  checkFn: (userId: string) => Promise<T>;
  toggleFn: (userId: string) => Promise<T>;
};

type TitleToggleReturn<T> = {
  state: T;
  loading: boolean;
  saving: boolean;
  toggle: () => Promise<void>;
  isLoggedIn: boolean;
};

type ExternalTitleState<T> = {
  state: T | undefined;
  loading: boolean;
};

export function useTitleToggle<T>(
  initialState: T,
  config: TitleToggleConfig<T>,
  deps: unknown[],
  externalState?: ExternalTitleState<T>,
): TitleToggleReturn<T> {
  const { user, loading: userLoading } = useAuth();
  const [state, setState] = useState<T>(initialState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (userLoading) return;

    if (!user) {
      setState(initialState);
      setLoading(false);
      return;
    }

    if (externalState?.state !== undefined) {
      setState(externalState.state);
      setLoading(externalState.loading);
      return;
    }

    setLoading(true);
    config.checkFn(user.id)
      .then(setState)
      .catch(() => setState(initialState))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userLoading, externalState?.state, externalState?.loading, ...deps]);

  async function toggle() {
    if (!user || saving) return;
    setSaving(true);
    try {
      const next = await config.toggleFn(user.id);
      setState(next);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return { state, loading, saving, toggle, isLoggedIn: !!user };
}

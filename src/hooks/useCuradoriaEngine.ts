"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calculatePriorityScore,
  selectHeroItems,
} from "@/lib/curadoria-engine";
import type {
  ScoredItem,
  SignalType,
  UserCuradoriaPreferences,
  UserWatching,
} from "@/components/HeroSpotlight/types";

export type CuradoriaEngineMode =
  | "hero"
  | "continue_watching"
  | "suggestions"
  | "watchlist";

export interface CuradoriaEngineOptions {
  mode?: CuradoriaEngineMode;
  limit?: number;
}

export interface UseCuradoriaEngineReturn {
  items: ScoredItem[];
  heroItems: ScoredItem[];
  isLoading: boolean;
  recalculate: () => void;
  snoozeItem: (contentId: string, durationHours?: number) => Promise<void>;
  markAsWatched: (contentId: string) => Promise<void>;
  logSignal: (
    contentId: string,
    signal: SignalType,
    value?: object
  ) => Promise<void>;
}

type AcompanhandoResponse = {
  ok: boolean;
  items?: UserWatching[];
  preferences?: UserCuradoriaPreferences | null;
  prefs?: UserCuradoriaPreferences | null;
  error?: string;
};

const DEFAULT_PREFS: Omit<UserCuradoriaPreferences, "user_id" | "updated_at"> =
  {
    preferred_session_duration_minutes: 60,
    typical_watch_days: null,
    typical_watch_time_start: null,
    typical_watch_time_end: null,
    top_genres: null,
    top_platforms: null,
    avg_episodes_per_session: null,
    prefers_short_content: false,
    binge_tendency_score: 0.5,
  };

function getFallbackPrefs(): UserCuradoriaPreferences {
  return {
    user_id: "",
    updated_at: new Date().toISOString(),
    ...DEFAULT_PREFS,
  } as UserCuradoriaPreferences;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

async function postCuradoriaAction(body: unknown) {
  const res = await fetch("/api/poplog3/acompanhando", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = "Falha ao registrar ação de curadoria.";

    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // Mantém mensagem genérica.
    }

    throw new Error(message);
  }

  return res.json().catch(() => null);
}

export function useCuradoriaEngine({
  mode = "hero",
  limit,
}: CuradoriaEngineOptions = {}): UseCuradoriaEngineReturn {
  const [rawItems, setRawItems] = useState<UserWatching[]>([]);
  const [prefs, setPrefs] = useState<UserCuradoriaPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);

    try {
      const res = await fetch("/api/poplog3/acompanhando", {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "application/json",
        },
      });

      if (!res.ok) {
        setRawItems([]);
        setPrefs(null);
        return;
      }

      const json = (await res.json()) as AcompanhandoResponse;

      setRawItems(json.ok && Array.isArray(json.items) ? json.items : []);
      setPrefs(json.preferences ?? json.prefs ?? null);
    } catch (error) {
      if (isAbortError(error)) return;

      console.error("[useCuradoriaEngine] fetchData error:", error);
      setRawItems([]);
      setPrefs(null);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchData();

    return () => {
      abortRef.current?.abort();
    };
  }, [fetchData]);

  const scoredItems = useMemo<ScoredItem[]>(() => {
    const effectivePrefs = prefs ?? getFallbackPrefs();
    const now = new Date();

    return rawItems
      .map((item) => calculatePriorityScore(item, effectivePrefs, now))
      .sort((a, b) => b.score - a.score);
  }, [rawItems, prefs]);

  const items = useMemo<ScoredItem[]>(() => {
    let nextItems = scoredItems;

    if (mode === "continue_watching") {
      nextItems = scoredItems.filter((item) => item.status === "watching");
    }

    if (mode === "watchlist") {
      nextItems = scoredItems.filter((item) => item.status === "watchlist");
    }

    if (mode === "suggestions") {
      nextItems = scoredItems.filter(
        (item) => item.status === "watchlist" || item.status === "paused"
      );
    }

    if (typeof limit === "number" && limit > 0) {
      return nextItems.slice(0, limit);
    }

    return nextItems;
  }, [scoredItems, mode, limit]);

  const heroItems = useMemo(() => selectHeroItems(scoredItems), [scoredItems]);

  const recalculate = useCallback(() => {
    fetchData();
  }, [fetchData]);

  const snoozeItem = useCallback(
    async (contentId: string, durationHours = 4) => {
      const snoozedUntil = new Date(
        Date.now() + durationHours * 60 * 60 * 1000
      ).toISOString();

      const previousItems = rawItems;

      setRawItems((prev) =>
        prev.map((item) =>
          item.content_id === contentId
            ? { ...item, snoozed_until: snoozedUntil }
            : item
        )
      );

      try {
        await postCuradoriaAction({
          action: "snooze",
          contentId,
          durationHours,
        });

        await fetchData();
      } catch (error) {
        console.error("[useCuradoriaEngine] snoozeItem error:", error);
        setRawItems(previousItems);
        await fetchData();
      }
    },
    [fetchData, rawItems]
  );

  const markAsWatched = useCallback(
    async (contentId: string) => {
      const now = new Date().toISOString();
      const previousItems = rawItems;

      setRawItems((prev) =>
        prev.map((item) =>
          item.content_id === contentId
            ? { ...item, last_watched_at: now, status: "finished" }
            : item
        )
      );

      try {
        await postCuradoriaAction({
          action: "mark_watched",
          contentId,
        });

        await fetchData();
      } catch (error) {
        console.error("[useCuradoriaEngine] markAsWatched error:", error);
        setRawItems(previousItems);
        await fetchData();
      }
    },
    [fetchData, rawItems]
  );

  const logSignal = useCallback(
    async (contentId: string, signal: SignalType, value?: object) => {
      try {
        await postCuradoriaAction({
          action: "log_signal",
          contentId,
          signal,
          value: value ?? null,
        });
      } catch (error) {
        console.error("[useCuradoriaEngine] logSignal error:", error);
      }
    },
    []
  );

  return {
    items,
    heroItems,
    isLoading,
    recalculate,
    snoozeItem,
    markAsWatched,
    logSignal,
  };
}
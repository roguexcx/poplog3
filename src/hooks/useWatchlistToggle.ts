// src/hooks/useWatchlistToggle.ts
"use client";

import { useCallback } from "react";

import { useTitleToggle } from "@/hooks/useTitleToggle";
import { isTitleInWatchlist, toggleWatchlist } from "@/lib/user-title-service";
import type { MediaType } from "@/lib/user-title-service";

type Input = {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  releaseYear?: number | null;
};

function notifyUserTitlesUpdated() {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new Event("poplog:user-titles-updated"));
}

export function useWatchlistToggle({
  tmdbId,
  mediaType,
  title,
  releaseYear,
}: Input) {
  const {
    state: inWatchlist,
    loading,
    saving,
    toggle,
    isLoggedIn,
  } = useTitleToggle(
    false,
    {
      checkFn: (userId) => isTitleInWatchlist(userId, tmdbId, mediaType),
      toggleFn: (userId) =>
        toggleWatchlist({ userId, tmdbId, mediaType, title, releaseYear }),
    },
    [tmdbId, mediaType],
  );

  const toggleAndNotify = useCallback(async () => {
    await toggle();
    notifyUserTitlesUpdated();
  }, [toggle]);

  return {
    inWatchlist,
    loading,
    saving,
    toggle: toggleAndNotify,
    isLoggedIn,
  };
}
"use client";

import { useCallback } from "react";

import { notifyUserTitlesUpdated, useTitleToggle } from "@/hooks/useTitleToggle";
import { isTitleWatched, toggleWatched } from "@/lib/user-title-service";
import type { MediaType } from "@/lib/user-title-service";

type Input = {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  releaseYear?: number | null;
};

export function useWatchedToggle({
  tmdbId,
  mediaType,
  title,
  releaseYear,
}: Input) {
  const {
    state: isWatched,
    loading,
    saving,
    toggle,
    isLoggedIn,
  } = useTitleToggle(
    false,
    {
      checkFn: (userId) => isTitleWatched(userId, tmdbId, mediaType),
      toggleFn: (userId) =>
        toggleWatched({ userId, tmdbId, mediaType, title, releaseYear }),
    },
    [tmdbId, mediaType],
  );

  const toggleAndNotify = useCallback(async () => {
    await toggle();
    notifyUserTitlesUpdated();
  }, [toggle]);

  return {
    isWatched,
    loading,
    saving,
    toggle: toggleAndNotify,
    isLoggedIn,
  };
}

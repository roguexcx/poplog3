"use client";

import { useCallback } from "react";

import { notifyUserTitlesUpdated, useTitleToggle } from "@/hooks/useTitleToggle";
import { isTitleWatched, toggleWatched } from "@/lib/user-title-service";
import type { MediaType } from "@/lib/user-title-service";

type Input = {
  tmdbId: number;
  poplogId?: string | number | null;
  imdbId?: string | null;
  slug?: string | null;
  mediaType: MediaType;
  title: string;
  releaseYear?: number | null;
};

export function useWatchedToggle({
  tmdbId,
  poplogId,
  imdbId,
  slug,
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
      checkFn: (userId) => isTitleWatched(userId, tmdbId, mediaType, { poplogId, imdbId, slug }),
      toggleFn: (userId) =>
        toggleWatched({ userId, tmdbId, poplogId, imdbId, slug, mediaType, title, releaseYear }),
    },
    [tmdbId, poplogId, imdbId, slug, mediaType],
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

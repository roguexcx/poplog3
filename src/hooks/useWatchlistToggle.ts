"use client";

import { useCallback } from "react";

import { useOptionalUserData } from "@/context/UserDataContext";
import { notifyUserTitlesUpdated, useTitleToggle } from "@/hooks/useTitleToggle";
import { findUserTitleByIdentity } from "@/lib/user-title-identity";
import { isTitleInWatchlist, toggleWatchlist } from "@/lib/user-title-service";
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

export function useWatchlistToggle({
  tmdbId,
  poplogId,
  imdbId,
  slug,
  mediaType,
  title,
  releaseYear,
}: Input) {
  const userData = useOptionalUserData();
  const globalTitle = userData
    ? findUserTitleByIdentity(userData.titles, { tmdbId, poplogId, imdbId, slug, mediaType })
    : undefined;
  const {
    state: inWatchlist,
    loading,
    saving,
    toggle,
    isLoggedIn,
  } = useTitleToggle(
    false,
    {
      checkFn: (userId) => isTitleInWatchlist(userId, tmdbId, mediaType, { poplogId, imdbId, slug }),
      toggleFn: (userId) =>
        toggleWatchlist({ userId, tmdbId, poplogId, imdbId, slug, mediaType, title, releaseYear }),
    },
    [tmdbId, poplogId, imdbId, slug, mediaType],
    userData
      ? {
          state: globalTitle ? globalTitle.status === "watchlist" : false,
          loading: userData.loading,
        }
      : undefined,
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

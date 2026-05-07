// src/hooks/useWatchlistToggle.ts
"use client";

import { useTitleToggle } from "@/hooks/useTitleToggle";
import { isTitleInWatchlist, toggleWatchlist } from "@/lib/user-title-service";
import type { MediaType } from "@/lib/user-title-service";

type Input = {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  releaseYear?: number | null;
};

export function useWatchlistToggle({ tmdbId, mediaType, title, releaseYear }: Input) {
  const { state: inWatchlist, loading, saving, toggle, isLoggedIn } = useTitleToggle(
    false,
    {
      checkFn: (userId) => isTitleInWatchlist(userId, tmdbId, mediaType),
      toggleFn: (userId) => toggleWatchlist({ userId, tmdbId, mediaType, title, releaseYear }),
    },
    [tmdbId, mediaType],
  );

  return { inWatchlist, loading, saving, toggle, isLoggedIn };
}
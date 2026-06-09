"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUserStatesStore } from "@/stores/user-states-store";
import { notifyUserTitlesUpdated } from "@/hooks/useTitleToggle";
import {
  postEpisodeProgress,
  dispatchSeriesProgressRefresh,
  dispatchLibraryStatusChanged,
  episodeKey,
  type EpisodeProgressResponse,
} from "@/features/title/episodeProgressClient";

type Input = {
  /** tmdbId positivo ou sintético da série. */
  seriesTmdbId: number;
  /** poplogId da série (CUID), usado para atualizar o Zustand store. */
  poplogId?: string | null;
  /** Keys de episódios já assistidos: "S01E01", "S01E02", etc. */
  initialWatchedKeys?: string[];
};

type UseSeriesProgressReturn = {
  watchedKeys: Set<string>;
  isMarking: boolean;
  toggleEpisode: (season: number, episode: number, watched: boolean, runtimeMinutes?: number | null) => Promise<void>;
  markUntil: (season: number, episode: number) => Promise<void>;
  markSeason: (season: number) => Promise<void>;
  clearProgress: () => Promise<void>;
};

/**
 * Hook que gerencia o progresso de episódios de uma série.
 *
 * - Mantém `watchedKeys` localmente para optimistic updates imediatos.
 * - Após cada mutação, sincroniza o Zustand store e dispara eventos globais.
 * - Acompanhando, Biblioteca, TitleActions e TitleEpisodeBrowser ouvem esses
 *   eventos e atualizam automaticamente.
 */
export function useSeriesProgress({
  seriesTmdbId,
  poplogId,
  initialWatchedKeys = [],
}: Input): UseSeriesProgressReturn {
  const [watchedKeys, setWatchedKeys] = useState<Set<string>>(
    () => new Set(initialWatchedKeys),
  );
  const [isMarking, setIsMarking] = useState(false);
  const { patchUserState } = useUserStatesStore();
  const latestKeysRef = useRef<Set<string>>(watchedKeys);

  // Sync ref when state changes
  useEffect(() => {
    latestKeysRef.current = watchedKeys;
  }, [watchedKeys]);

  // Update watchedKeys when initialWatchedKeys changes (ex: parent reloads data)
  useEffect(() => {
    setWatchedKeys(new Set(initialWatchedKeys));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWatchedKeys.join(",")]);

  const applyProgressResponse = useCallback(
    (res: EpisodeProgressResponse) => {
      const keys = res.progress?.watchedKeys ?? res.watchedKeys;
      if (Array.isArray(keys)) {
        const next = new Set(keys);
        setWatchedKeys(next);
        latestKeysRef.current = next;
      }

      // Atualiza o progressPercent no Zustand se houver poplogId
      if (poplogId && res.progress) {
        const watched = res.progress.watchedCount;
        if (typeof watched === "number") {
          patchUserState(poplogId, {
            progressPercent: undefined, // será recalculado pelo backend
          });
        }
      }

      // Eventos globais para sincronização de Acompanhando, Biblioteca, TitleActions
      dispatchSeriesProgressRefresh(seriesTmdbId);
      notifyUserTitlesUpdated();
    },
    [seriesTmdbId, poplogId, patchUserState],
  );

  const toggleEpisode = useCallback(
    async (season: number, episode: number, watched: boolean, runtimeMinutes?: number | null) => {
      const key = episodeKey(season, episode);

      // Optimistic update
      setWatchedKeys((prev) => {
        const next = new Set(prev);
        if (watched) {
          next.add(key);
        } else {
          next.delete(key);
        }
        return next;
      });

      setIsMarking(true);
      try {
        const res = await postEpisodeProgress({
          seriesTmdbId,
          seasonNumber: season,
          episodeNumber: episode,
          watched,
          runtimeMinutes: runtimeMinutes ?? undefined,
        });
        applyProgressResponse(res);
      } catch (error) {
        // Revert optimistic update
        setWatchedKeys(new Set(latestKeysRef.current));
        console.error("[useSeriesProgress] toggleEpisode falhou:", error);
      } finally {
        setIsMarking(false);
      }
    },
    [seriesTmdbId, applyProgressResponse],
  );

  const markUntil = useCallback(
    async (season: number, episode: number) => {
      setIsMarking(true);
      try {
        const res = await postEpisodeProgress({
          seriesTmdbId,
          markUntil: { seasonNumber: season, episodeNumber: episode },
        });
        applyProgressResponse(res);
      } catch (error) {
        console.error("[useSeriesProgress] markUntil falhou:", error);
      } finally {
        setIsMarking(false);
      }
    },
    [seriesTmdbId, applyProgressResponse],
  );

  const markSeason = useCallback(
    async (season: number) => {
      setIsMarking(true);
      try {
        const res = await postEpisodeProgress({
          seriesTmdbId,
          markSeason: season,
        });
        applyProgressResponse(res);
        dispatchLibraryStatusChanged(seriesTmdbId, "watching");
      } catch (error) {
        console.error("[useSeriesProgress] markSeason falhou:", error);
      } finally {
        setIsMarking(false);
      }
    },
    [seriesTmdbId, applyProgressResponse],
  );

  const clearProgress = useCallback(async () => {
    setIsMarking(true);
    try {
      const res = await postEpisodeProgress({
        seriesTmdbId,
        clear: true,
      });
      applyProgressResponse(res);
      dispatchLibraryStatusChanged(seriesTmdbId, "watchlist");
    } catch (error) {
      console.error("[useSeriesProgress] clearProgress falhou:", error);
    } finally {
      setIsMarking(false);
    }
  }, [seriesTmdbId, applyProgressResponse]);

  return { watchedKeys, isMarking, toggleEpisode, markUntil, markSeason, clearProgress };
}

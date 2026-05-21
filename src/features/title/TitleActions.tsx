"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import ActionButton from "@/components/ui/ActionButton";
import { IconBookmark, IconCheck } from "@/components/ui/icons";

import ProgressMenu from "./ProgressMenu";
import ProgressUpdateModal from "./ProgressUpdateModal";
import {
  clearSeriesProgress,
  dispatchSeriesProgressRefresh,
  markEpisodesUntil,
  markSeasonProgress as markSeasonEpisodeProgress,
  postEpisodeProgress,
  toPositiveTmdbId,
} from "./episodeProgressClient";
import type { TitleMediaType, TitleUserState } from "./types";

type LibraryStatus =
  | "watchlist"
  | "watching"
  | "watched"
  | "abandoned"
  | "fridge";

type TitleSeasonSummary = {
  seasonNumber: number;
  name?: string | null;
  episodeCount: number | null;
};

type TitleActionsProps = {
  tmdbId: number | string;
  mediaType: TitleMediaType;
  initialState?: TitleUserState;
  seasons?: TitleSeasonSummary[];
};

function userStateToStatus(
  state: TitleUserState | undefined
): LibraryStatus | null {
  if (!state) return null;

  switch (state.computedState) {
    case "watched":
    case "completed":
    case "up_to_date":
      return "watched";
    case "in_progress":
      return "watching";
    case "watchlist":
      return "watchlist";
    case "abandoned":
      return "abandoned";
    case "fridge":
      return "fridge";
  }

  if (state.watched) return "watched";
  if (state.watching) return "watching";
  if (state.inWatchlist) return "watchlist";

  return null;
}

const LikeIcon = ({ active = false }: { active?: boolean }) => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill={active ? "currentColor" : "none"}
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path
      d="M7.5 21H5.25A2.25 2.25 0 0 1 3 18.75V11.5a2.25 2.25 0 0 1 2.25-2.25H7.5V21Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <path
      d="M7.5 10.25L11.2 3.7c.35-.62 1.02-.98 1.73-.9 1.04.11 1.79 1.05 1.65 2.08l-.52 3.87h4.2a2.7 2.7 0 0 1 2.63 3.3l-1.35 5.9A3.9 3.9 0 0 1 15.74 21H7.5V10.25Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

const DislikeIcon = ({ active = false }: { active?: boolean }) => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill={active ? "currentColor" : "none"}
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path
      d="M16.5 3h2.25A2.25 2.25 0 0 1 21 5.25v7.25a2.25 2.25 0 0 1-2.25 2.25H16.5V3Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <path
      d="M16.5 13.75l-3.7 6.55c-.35.62-1.02.98-1.73.9-1.04-.11-1.79-1.05-1.65-2.08l.52-3.87h-4.2a2.7 2.7 0 0 1-2.63-3.3l1.35-5.9A3.9 3.9 0 0 1 8.26 3h8.24v10.75Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

export default function TitleActions({
  tmdbId,
  mediaType,
  initialState,
  seasons = [],
}: TitleActionsProps) {
  const [status, setStatus] = useState<LibraryStatus | null>(
    userStateToStatus(initialState)
  );

  const [favorite, setFavorite] = useState(Boolean(initialState?.favorite));

  const [liked, setLiked] = useState<boolean | null>(() => {
    if (initialState?.liked === true) return true;
    if (initialState?.disliked === true) return false;
    return null;
  });

  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [progressModalOpen, setProgressModalOpen] = useState(false);

  const [, startTransition] = useTransition();

  const id = toPositiveTmdbId(tmdbId);
  const isAuthenticated = initialState?.isAuthenticated === true;
  const isTv = mediaType === "tv";

  const modalSeasons = useMemo(
    () =>
      seasons
        .filter(
          (season) =>
            season.seasonNumber > 0 &&
            typeof season.episodeCount === "number" &&
            season.episodeCount > 0
        )
        .map((season) => ({
          ...season,
          episodeCount: season.episodeCount ?? 0,
        }))
        .sort((a, b) => a.seasonNumber - b.seasonNumber),
    [seasons]
  );

  useEffect(() => {
    if (!isTv) return;

    function handleLibraryStatusChanged(event: Event) {
      const e = event as CustomEvent<{ tmdbId: number; status: string }>;

      if (e.detail?.tmdbId !== id) return;

      if (e.detail.status === "watching") {
        setStatus((prev) =>
          prev === null || prev === "watchlist" ? "watching" : prev
        );
      }
    }

    window.addEventListener(
      "poplog3:library-status-changed",
      handleLibraryStatusChanged
    );

    return () => {
      window.removeEventListener(
        "poplog3:library-status-changed",
        handleLibraryStatusChanged
      );
    };
  }, [id, isTv]);

  const labels = useMemo(
    () => ({
      watchlist: status === "watchlist" ? "Na watchlist" : "Watchlist",
      watching:
        status === "fridge"
          ? "Série pausada"
          : status === "watched"
            ? "Em dia"
            : "Assistindo",
      progress: "Progresso",
      watched: status === "watched" ? "Assistido" : "Marcar assistido",
      favorite: favorite ? "Favoritado" : "Favorito",
      liked: "Gostei",
      disliked: "Não curti",
      fridge: status === "fridge" ? "Em pausa" : "Pausar série",
    }),
    [status, favorite]
  );

  async function syncEpisodes(target: LibraryStatus | null) {
    if (!isTv) return;

    try {
      if (target === "watched") {
        await postEpisodeProgress({
          seriesTmdbId: id,
          markAllAired: true,
        });
      }

      dispatchSeriesProgressRefresh(id);
    } catch (err) {
      console.warn("[title-actions] sync episodes falhou:", err);
    }
  }

  async function commit(
    action: string,
    payload: {
      status?: LibraryStatus | null;
      favorite?: boolean;
      liked?: boolean | null;
    }
  ) {
    setError(null);

    const targetStatus = payload.status === undefined ? status : payload.status;
    const targetFavorite =
      payload.favorite === undefined ? favorite : payload.favorite;
    const targetLiked = payload.liked === undefined ? liked : payload.liked;

    setPendingAction(action);

    startTransition(async () => {
      try {
        if (targetStatus === null) {
          const res = await fetch("/api/library/title", {
            method: "DELETE",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              tmdbId: id,
              mediaType,
            }),
          });

          if (!res.ok && res.status !== 401) {
            throw new Error(`DELETE ${res.status}`);
          }
        } else {
          const res = await fetch("/api/library/title", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              tmdbId: id,
              mediaType,
              status: targetStatus,
              favorite: targetFavorite,
              liked: targetLiked,
            }),
          });

          if (!res.ok) {
            throw new Error(`POST ${res.status}`);
          }
        }

        if (payload.status !== undefined) {
          await syncEpisodes(targetStatus);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erro inesperado");
      } finally {
        setPendingAction(null);
      }
    });
  }

  function toggleStatus(target: LibraryStatus) {
    const next = status === target ? null : target;

    setStatus(next);

    commit(target, {
      status: next,
    });
  }

  function startWatching() {
    setStatus("watching");
    setProgressModalOpen(true);

    commit("watching", {
      status: "watching",
    });
  }

  function markAiredEpisodesWatched() {
    setStatus("watched");

    commit("mark-aired-watched", {
      status: "watched",
    });
  }

  function toggleFridge() {
    const next: LibraryStatus = status === "fridge" ? "watching" : "fridge";

    setStatus(next);

    commit("fridge", {
      status: next,
    });
  }

  function toggleFavorite() {
    const next = !favorite;

    setFavorite(next);

    const ensureStatus: LibraryStatus | null =
      status ?? (next ? "watched" : null);

    if (ensureStatus !== status) {
      setStatus(ensureStatus);
    }

    commit("favorite", {
      favorite: next,
      status: ensureStatus,
    });
  }

  function toggleLiked(value: boolean) {
    const next = liked === value ? null : value;

    setLiked(next);

    const ensureStatus: LibraryStatus | null =
      status ?? (next !== null ? "watched" : null);

    if (ensureStatus !== status) {
      setStatus(ensureStatus);
    }

    commit(value ? "liked" : "disliked", {
      liked: next,
      status: ensureStatus,
    });
  }

  async function confirmProgress(payload: {
    seasonNumber: number;
    episodeNumber: number;
  }) {
    setError(null);
    setPendingAction("update-progress");
    setStatus("watching");
    setProgressModalOpen(false);

    try {
      if (id <= 0) {
        throw new Error("ID TMDB invalido");
      }

      const seasonNumber = Number(payload.seasonNumber);
      const episodeNumber = Number(payload.episodeNumber);

      if (
        !Number.isFinite(seasonNumber) ||
        seasonNumber < 0 ||
        !Number.isFinite(episodeNumber) ||
        episodeNumber <= 0
      ) {
        throw new Error("Progresso invalido");
      }

      await markEpisodesUntil({
        seriesTmdbId: id,
        seasonNumber: Math.floor(seasonNumber),
        episodeNumber: Math.floor(episodeNumber),
      });

      dispatchSeriesProgressRefresh(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setPendingAction(null);
    }
  }

  async function markSeasonProgress(payload: { seasonNumber: number }) {
    setError(null);
    setPendingAction("mark-season");
    setStatus("watching");
    setProgressModalOpen(false);

    try {
      if (id <= 0) {
        throw new Error("ID TMDB invalido");
      }

      const seasonNumber = Number(payload.seasonNumber);

      if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) {
        throw new Error("Temporada invalida");
      }

      await markSeasonEpisodeProgress({
        seriesTmdbId: id,
        seasonNumber: Math.floor(seasonNumber),
      });

      dispatchSeriesProgressRefresh(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setPendingAction(null);
    }
  }

  async function clearEpisodeProgress() {
    setError(null);
    setPendingAction("clear-progress");
    setStatus("watching");
    setProgressModalOpen(false);

    try {
      if (id <= 0) {
        throw new Error("ID TMDB invalido");
      }

      await clearSeriesProgress({
        seriesTmdbId: id,
      });

      dispatchSeriesProgressRefresh(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setPendingAction(null);
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-wrap gap-2.5">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.04] px-4 py-2 text-[13px] font-semibold text-white/68 backdrop-blur-md">
          <span aria-hidden>✦</span>
          Entre para salvar este título
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 sm:gap-2.5">
        <ActionButton
          variant="primary"
          size="md"
          leftIcon={<IconBookmark filled={status === "watchlist"} />}
          active={status === "watchlist"}
          loading={pendingAction === "watchlist"}
          onClick={() => toggleStatus("watchlist")}
        >
          {labels.watchlist}
        </ActionButton>

        {isTv ? (
          <>
            <ActionButton
              variant={status === "fridge" ? "utility" : "secondary"}
              size="md"
              active={
                status === "watching" ||
                status === "watched" ||
                status === "fridge"
              }
              loading={pendingAction === "watching"}
              onClick={startWatching}
            >
              {labels.watching}
            </ActionButton>

            <ProgressMenu
              statusLabel={labels.progress}
              isUpToDate={status === "watched"}
              loading={
                pendingAction === "mark-aired-watched" ||
                pendingAction === "update-progress"
              }
              onUpdateProgress={() => setProgressModalOpen(true)}
              onMarkUpToDate={markAiredEpisodesWatched}
            />
          </>
        ) : (
          <ActionButton
            variant="secondary"
            size="md"
            leftIcon={<IconCheck />}
            active={status === "watched"}
            loading={pendingAction === "watched"}
            onClick={() => toggleStatus("watched")}
          >
            {labels.watched}
          </ActionButton>
        )}
      </div>

      <div className="flex flex-wrap gap-2 sm:gap-2.5">
        <ActionButton
          variant="social"
          size="sm"
          active={favorite}
          loading={pendingAction === "favorite"}
          onClick={toggleFavorite}
          leftIcon={
            <span aria-hidden className="text-[13px]">
              {favorite ? "★" : "☆"}
            </span>
          }
        >
          {labels.favorite}
        </ActionButton>

        <ActionButton
          variant="social"
          size="sm"
          active={liked === true}
          loading={pendingAction === "liked"}
          onClick={() => toggleLiked(true)}
          leftIcon={<LikeIcon active={liked === true} />}
        >
          {labels.liked}
        </ActionButton>

        <ActionButton
          variant={liked === false ? "danger" : "social"}
          size="sm"
          active={liked === false}
          loading={pendingAction === "disliked"}
          onClick={() => toggleLiked(false)}
          leftIcon={<DislikeIcon active={liked === false} />}
        >
          {labels.disliked}
        </ActionButton>

        {isTv && (
          <ActionButton
            variant="utility"
            size="sm"
            active={status === "fridge"}
            loading={pendingAction === "fridge"}
            onClick={toggleFridge}
            leftIcon={
              <span aria-hidden className="text-[13px]">
                ❄
              </span>
            }
          >
            {labels.fridge}
          </ActionButton>
        )}
      </div>

      {status === "fridge" && isTv && (
        <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-cyan-200/[0.14] bg-cyan-950/[0.16] px-3.5 py-2 text-xs font-medium text-cyan-50/78 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
          <span aria-hidden className="text-cyan-100">
            ❄
          </span>
          Série pausada e fora do radar. Retorne quando quiser continuar.
        </div>
      )}

      {isTv && (
        <ProgressUpdateModal
          open={progressModalOpen}
          title="Atualizar progresso"
          seasons={modalSeasons}
          loading={
            pendingAction === "update-progress" ||
            pendingAction === "mark-season" ||
            pendingAction === "clear-progress"
          }
          error={
            pendingAction === "update-progress" ||
            pendingAction === "mark-season" ||
            pendingAction === "clear-progress" ||
            progressModalOpen
              ? error
              : null
          }
          onClose={() => setProgressModalOpen(false)}
          onConfirm={confirmProgress}
          onMarkSeason={markSeasonProgress}
          onClearProgress={clearEpisodeProgress}
        />
      )}

      {error && !progressModalOpen && (
        <p className="text-xs font-semibold text-rose-200/90">
          Falha ao sincronizar: {error}
        </p>
      )}
    </div>
  );
}

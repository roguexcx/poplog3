"use client";

import { useMemo, useState, useTransition } from "react";

import ActionButton from "@/components/ui/ActionButton";
import {
  IconBookmark,
  IconCheck,
  IconX,
} from "@/components/ui/icons";

import type {
  TitleMediaType,
  TitleUserState,
} from "./types";

type LibraryStatus =
  | "watchlist"
  | "watching"
  | "watched"
  | "abandoned"
  | "fridge";

type TitleActionsProps = {
  tmdbId: number | string;
  mediaType: TitleMediaType;
  initialState?: TitleUserState;
};

function userStateToStatus(
  state: TitleUserState | undefined
): LibraryStatus | null {
  if (!state) return null;

  // Fast path: usa computedState materializado para evitar recalcular localmente
  switch (state.computedState) {
    case "watched":
    case "completed":
      return "watched";
    case "up_to_date":
    case "in_progress":
      return "watching";
    case "watchlist":
      return "watchlist";
    case "abandoned":
      return "abandoned";
    case "fridge":
      return "fridge";
  }

  // Fallback para usuários sem computedState ainda (pré-migração)
  if (state.watched) return "watched";
  if (state.watching) return "watching";
  if (state.inWatchlist) return "watchlist";

  return null;
}

function emitSeriesProgressRefresh(seriesTmdbId: number) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("poplog3:series-progress-refresh", {
      detail: {
        seriesTmdbId,
      },
    })
  );
}

export default function TitleActions({
  tmdbId,
  mediaType,
  initialState,
}: TitleActionsProps) {
  const [status, setStatus] = useState<LibraryStatus | null>(
    userStateToStatus(initialState)
  );

  const [favorite, setFavorite] = useState(
    Boolean(initialState?.favorite)
  );

  const [liked, setLiked] = useState<boolean | null>(() => {
    if (initialState?.liked === true) return true;
    if (initialState?.disliked === true) return false;
    return null;
  });

  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const [, startTransition] = useTransition();

  const id = Number(tmdbId);

  const isAuthenticated = initialState?.isAuthenticated === true;

  const isWatched = status === "watched";
  const showWatchingButton = !isWatched;

  const labels = useMemo(
    () => ({
      watchlist:
        status === "watchlist"
          ? "Na watchlist"
          : "Watchlist",

      watched:
        status === "watched"
          ? "Assistido"
          : "Marcar assistido",

      watching:
        status === "watching"
          ? "Assistindo"
          : "Assistir",

      favorite:
        favorite
          ? "Favoritado"
          : "Favorito",

      liked: "Gostei",

      disliked: "Não curti",
    }),
    [status, favorite]
  );

  async function syncEpisodes(target: LibraryStatus | null) {
    if (mediaType !== "tv") return;

    try {
      if (target === "watched") {
        const res = await fetch("/api/poplog3/episodes", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            seriesTmdbId: id,
            markAllAired: true,
          }),
        });

        if (!res.ok) {
          throw new Error(`episodes ${res.status}`);
        }

        emitSeriesProgressRefresh(id);
      }

      if (target !== "watched") {
        emitSeriesProgressRefresh(id);
      }
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

    const targetStatus =
      payload.status === undefined
        ? status
        : payload.status;

    const targetFavorite =
      payload.favorite === undefined
        ? favorite
        : payload.favorite;

    const targetLiked =
      payload.liked === undefined
        ? liked
        : payload.liked;

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
        setError(
          err instanceof Error
            ? err.message
            : "Erro inesperado"
        );
      } finally {
        setPendingAction(null);
      }
    });
  }

  function toggleStatus(target: LibraryStatus) {
    const next =
      status === target
        ? null
        : target;

    setStatus(next);

    commit(target, {
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
    const next =
      liked === value
        ? null
        : value;

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
          leftIcon={
            <IconBookmark
              filled={status === "watchlist"}
            />
          }
          active={status === "watchlist"}
          loading={pendingAction === "watchlist"}
          onClick={() => toggleStatus("watchlist")}
        >
          {labels.watchlist}
        </ActionButton>

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

        {showWatchingButton && (
          <ActionButton
            variant="secondary"
            size="md"
            active={status === "watching"}
            loading={pendingAction === "watching"}
            onClick={() => toggleStatus("watching")}
          >
            {labels.watching}
          </ActionButton>
        )}

        <ActionButton
          variant="secondary"
          size="md"
          active={favorite}
          loading={pendingAction === "favorite"}
          onClick={toggleFavorite}
          leftIcon={
            <span
              aria-hidden
              className="text-[13px]"
            >
              {favorite ? "★" : "☆"}
            </span>
          }
        >
          {labels.favorite}
        </ActionButton>

        <ActionButton
          variant="secondary"
          size="md"
          active={liked === true}
          loading={pendingAction === "liked"}
          onClick={() => toggleLiked(true)}
          leftIcon={
            <span
              aria-hidden
              className="text-[13px]"
            >
              ↑
            </span>
          }
        >
          {labels.liked}
        </ActionButton>

        <ActionButton
          variant="secondary"
          size="md"
          active={liked === false}
          loading={pendingAction === "disliked"}
          onClick={() => toggleLiked(false)}
          leftIcon={<IconX />}
        >
          {labels.disliked}
        </ActionButton>
      </div>

      {error && (
        <p className="text-xs font-semibold text-rose-200/90">
          Falha ao sincronizar: {error}
        </p>
      )}
    </div>
  );
}
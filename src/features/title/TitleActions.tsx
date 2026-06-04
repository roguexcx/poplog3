"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import ActionButton from "@/components/ui/ActionButton";
import { IconBookmark, IconCheck } from "@/components/ui/icons";

import ProgressUpdateModal from "./ProgressUpdateModal";
import {
  clearSeriesProgress,
  dispatchSeriesProgressRefresh,
  markEpisodesUntil,
  markSeasonProgress as markSeasonEpisodeProgress,
  postEpisodeProgress,
  toPositiveTmdbId,
} from "./episodeProgressClient";
import type { TitleMediaType, TitleSeriesProgress, TitleUserState } from "./types";

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
  poplogId?: string | number | null;
  imdbId?: string | null;
  slug?: string | null;
  mediaType: TitleMediaType;
  initialState?: TitleUserState;
  initialProgress?: TitleSeriesProgress | null;
  seasons?: TitleSeasonSummary[];
  /** Status TMDB da serie — ex: "Ended", "Returning Series", "Canceled". */
  seriesStatus?: string | null;
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

export default function TitleActions({
  tmdbId,
  poplogId = null,
  imdbId = null,
  slug = null,
  mediaType,
  initialState,
  initialProgress,
  seasons = [],
  seriesStatus,
}: TitleActionsProps) {
  const [status, setStatus] = useState<LibraryStatus | null>(
    userStateToStatus(initialState)
  );

  const [favorite, setFavorite] = useState(Boolean(initialState?.favorite));

  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [progressModalOpen, setProgressModalOpen] = useState(false);

  // Controla confirmacao leve antes de mover para Abandonado
  const [abandonConfirmOpen, setAbandonConfirmOpen] = useState(false);

  // Rastreia watchedCount local (atualizado apos acoes de progresso)
  const [localWatchedCount, setLocalWatchedCount] = useState<number>(
    initialProgress?.watchedCount ?? 0
  );

  const [, startTransition] = useTransition();

  const id = toPositiveTmdbId(tmdbId);
  const identityPayload = useMemo(
    () => ({
      tmdbId: id,
      poplogId,
      imdbId,
      slug,
      mediaType,
    }),
    [id, poplogId, imdbId, slug, mediaType]
  );
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

    function handleProgressRefresh(event: Event) {
      const e = event as CustomEvent<{ seriesTmdbId: number; watchedCount?: number }>;
      if (e.detail?.seriesTmdbId !== id) return;
      if (typeof e.detail.watchedCount === "number") {
        setLocalWatchedCount(e.detail.watchedCount);
      }
    }

    window.addEventListener(
      "poplog3:library-status-changed",
      handleLibraryStatusChanged
    );
    window.addEventListener(
      "poplog3:series-progress-refresh",
      handleProgressRefresh
    );

    return () => {
      window.removeEventListener(
        "poplog3:library-status-changed",
        handleLibraryStatusChanged
      );
      window.removeEventListener(
        "poplog3:series-progress-refresh",
        handleProgressRefresh
      );
    };
  }, [id, isTv]);

  // Considera "progresso real" quando há episódios marcados OU estado oficial de andamento
  const hasRealProgress = localWatchedCount > 0 || status === "watching";

  const labels = useMemo(
    () => ({
      watchlist: status === "watchlist" ? "Na watchlist" : "Watchlist",
      watching:
        status === "fridge"
          ? "Série pausada"
          : status === "watched"
            ? "Em dia"
            : hasRealProgress
              ? "Assistindo"
              : "Adicionar série",
      watched: status === "watched" ? "Assistido" : "Marcar assistido",
      favorite: favorite ? "Favoritado" : "Favorito",
      fridge: status === "fridge" ? "Em pausa" : "Pausar série",
    }),
    [status, favorite, hasRealProgress]
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
    }
  ) {
    setError(null);

    const targetStatus = payload.status === undefined ? status : payload.status;

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
              ...identityPayload,
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
              ...identityPayload,
              status: targetStatus,
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
    const isCurrentlyWatching =
      status === "watching" || status === "watched" || status === "fridge";

    if (isCurrentlyWatching) {
      // Ja assistindo — abre o modal de progresso direto.
      // Abandonar esta acessivel como link dentro do modal.
      setProgressModalOpen(true);
      return;
    }

    setStatus("watching");
    setProgressModalOpen(true);

    commit("watching", {
      status: "watching",
    });
  }

  function confirmAbandon() {
    setAbandonConfirmOpen(false);
    setStatus("abandoned");
    commit("abandoned", { status: "abandoned" });
  }

  function cancelAbandon() {
    setAbandonConfirmOpen(false);
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
    const prevFavorite = favorite;
    const prevStatus = status;

    // Atualiza otimisticamente: favoritar auto-marca como assistido
    setFavorite(next);
    if (next) {
      setStatus("watched");
    }

    setPendingAction("favorite");

    startTransition(async () => {
      try {
        // PATCH em /api/library/title: seta favorite e (se next=true) marca watched
        const res = await fetch("/api/library/title", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...identityPayload,
            favorite: next,
          }),
        });
        if (!res.ok) {
          // Reverte o estado em caso de erro
          setFavorite(prevFavorite);
          if (next) setStatus(prevStatus);
          const json = await res.json().catch(() => ({}));
          setError(json?.error ?? `Favorite failed: ${res.status}`);
        }
      } catch (err) {
        setFavorite(prevFavorite);
        if (next) setStatus(prevStatus);
        setError(err instanceof Error ? err.message : "Erro inesperado");
      } finally {
        setPendingAction(null);
      }
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

      setLocalWatchedCount((prev) => Math.max(prev, 1));
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

      setLocalWatchedCount((prev) => Math.max(prev, 1));
      dispatchSeriesProgressRefresh(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setPendingAction(null);
    }
  }

  async function markAllAiredProgress() {
    setError(null);
    setPendingAction("mark-all-aired");
    setStatus("watching");
    setProgressModalOpen(false);

    try {
      if (id <= 0) {
        throw new Error("ID TMDB invalido");
      }

      const body = await postEpisodeProgress({
        seriesTmdbId: id,
        markAllAired: true,
      });

      if (typeof body.progress?.watchedCount === "number") {
        setLocalWatchedCount(body.progress.watchedCount);
      } else {
        setLocalWatchedCount((prev) => Math.max(prev, 1));
      }

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
    setProgressModalOpen(false);

    try {
      if (id <= 0) {
        throw new Error("ID TMDB invalido");
      }

      await clearSeriesProgress({
        seriesTmdbId: id,
      });

      setLocalWatchedCount(0);
      setStatus(null);
      commit("watching-off", { status: null });
      dispatchSeriesProgressRefresh(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setPendingAction(null);
    }
  }

  async function markAbandoned() {
    setProgressModalOpen(false);
    setStatus("abandoned");
    commit("abandoned", { status: "abandoned" });
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
                hasRealProgress ||
                status === "watched" ||
                status === "fridge"
              }
              loading={pendingAction === "watching"}
              onClick={startWatching}
            >
              {labels.watching}
            </ActionButton>

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

      {abandonConfirmOpen && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300/20 bg-amber-950/25 px-4 py-3 backdrop-blur-md">
          <span aria-hidden className="mt-0.5 shrink-0 text-amber-300">
            {"◈"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-amber-50">
              Voce tem progresso nesta serie
            </p>
            <p className="mt-0.5 text-[11px] font-medium leading-snug text-amber-200/65">
              Mover para Abandonado preserva os episodios assistidos.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={confirmAbandon}
                className="rounded-full border border-amber-200/30 bg-amber-300/[0.15] px-3.5 py-1.5 text-xs font-black text-amber-50 transition hover:bg-amber-300/[0.25]"
              >
                Mover para Abandonado
              </button>
              <button
                type="button"
                onClick={cancelAbandon}
                className="rounded-full border border-white/[0.10] bg-white/[0.04] px-3.5 py-1.5 text-xs font-bold text-white/60 transition hover:bg-white/[0.08] hover:text-white"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {isTv && (
        <ProgressUpdateModal
          open={progressModalOpen}
          title="Atualizar progresso"
          seasons={modalSeasons}
          hasProgress={localWatchedCount > 0}
          isEnded={seriesStatus === "Ended" || seriesStatus === "Canceled"}
          loading={
            pendingAction === "update-progress" ||
            pendingAction === "mark-season" ||
            pendingAction === "mark-all-aired" ||
            pendingAction === "clear-progress"
          }
          error={
            pendingAction === "update-progress" ||
            pendingAction === "mark-season" ||
            pendingAction === "mark-all-aired" ||
            pendingAction === "clear-progress" ||
            progressModalOpen
              ? error
              : null
          }
          onClose={() => setProgressModalOpen(false)}
          onConfirm={confirmProgress}
          onMarkSeason={markSeasonProgress}
          onMarkAllAired={markAllAiredProgress}
          onClearProgress={clearEpisodeProgress}
          onAbandon={markAbandoned}
        />
      )}

      {error && !progressModalOpen && !abandonConfirmOpen && (
        <p className="text-xs font-semibold text-rose-200/90">
          Falha ao sincronizar: {error}
        </p>
      )}
    </div>
  );
}

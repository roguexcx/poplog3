"use client";
// src/features/title/TitleActions.tsx

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { TitleActionSeason } from "@/features/title/title-types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "watchlist" | "watched" | "watching" | "fridge" | null;

type SeriesProgressEventDetail = {
  tmdbId: number;
  episodeCount: number;
  watchedEpisodes: number;
};

type UserTitle = {
  status: Status;
  favorite: boolean;
  watched_at: string | null;
};

type Props = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  releaseYear?: number | null;
  seasons?: TitleActionSeason[];
  inline?: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatWatchedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function emitSeriesBulkProgressUpdate(detail: {
  tmdbId: number;
  action: "mark-all" | "unmark-all";
  watchedAt?: string;
}) {
  window.dispatchEvent(new CustomEvent("poplog:series-bulk-progress", { detail }));
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconBookmark({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconCheck({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function IconStar({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconFridge({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="5" y1="10" x2="19" y2="10" />
      <line x1="10" y1="6" x2="10" y2="8" />
      <line x1="10" y1="14" x2="10" y2="18" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ─── Confirm Modal ─────────────────────────────────────────────────────────────

function ConfirmModal({
  title,
  message,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 rounded-2xl border border-white/10 bg-[#0e0e1a] p-4">
      <p className="mb-1 text-sm font-black text-white">{title}</p>
      <p className="mb-4 text-xs leading-relaxed text-slate-400">{message}</p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="flex-1 rounded-xl bg-white py-2 text-sm font-bold text-black transition hover:bg-sky-100"
        >
          Confirmar
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-xl border border-white/10 py-2 text-sm font-bold text-slate-400 transition hover:text-white"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TitleActions({
  tmdbId,
  mediaType,
  title,
  releaseYear,
  seasons = [],
  inline = false,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const isTv = mediaType === "tv";

  const [userId, setUserId]                 = useState<string | null>(null);
  const [userTitle, setUserTitle]           = useState<UserTitle>({ status: null, favorite: false, watched_at: null });
  const [loading, setLoading]               = useState<"watchlist" | "watched" | "conclude" | "favorite" | "fridge" | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showConfirm, setShowConfirm]       = useState(false);
  const [showSeriesMenu, setShowSeriesMenu] = useState(false);
  const [pickerDate, setPickerDate]         = useState(toDateInputValue(new Date()));
  const [seriesProgress, setSeriesProgress] = useState({ episodeCount: 0, watchedEpisodes: 0 });

  const seriesMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSeriesMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (seriesMenuRef.current && !seriesMenuRef.current.contains(e.target as Node)) {
        setShowSeriesMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSeriesMenu]);

  useEffect(() => {
    if (!isTv) return;

    async function loadSeriesProgress() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { count } = await supabase
        .from("episode_progress")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("tmdb_id", tmdbId);

      setSeriesProgress((prev) => ({ ...prev, watchedEpisodes: count ?? 0 }));
    }

    function handleProgressEvent(event: Event) {
      const customEvent = event as CustomEvent<SeriesProgressEventDetail>;
      if (customEvent.detail.tmdbId !== tmdbId) return;
      setSeriesProgress({
        episodeCount: customEvent.detail.episodeCount,
        watchedEpisodes: customEvent.detail.watchedEpisodes,
      });
    }

    loadSeriesProgress();
    window.addEventListener("poplog:series-progress", handleProgressEvent);
    return () => window.removeEventListener("poplog:series-progress", handleProgressEvent);
  }, [isTv, tmdbId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setInitialLoading(false); return; }

      setUserId(user.id);

      const { data } = await supabase
        .from("user_titles")
        .select("status, favorite, watched_at")
        .eq("user_id", user.id)
        .eq("tmdb_id", tmdbId)
        .eq("media_type", mediaType)
        .maybeSingle();

      if (data) {
        setUserTitle({
          status: data.status,
          favorite: data.favorite,
          watched_at: data.watched_at ?? null,
        });
      }
      setInitialLoading(false);
    }
    load();
  }, [tmdbId, mediaType]); // eslint-disable-line react-hooks/exhaustive-deps

  function requireAuth(): boolean {
    if (!userId) { router.push("/login"); return false; }
    return true;
  }

  async function save(patch: Partial<UserTitle>) {
    if (!userId) return;
    const next = { ...userTitle, ...patch };
    setUserTitle(next);

    await supabase.from("user_titles").upsert({
      user_id:      userId,
      tmdb_id:      tmdbId,
      media_type:   mediaType,
      status:       next.status,
      favorite:     next.favorite,
      watched_at:   next.watched_at,
      title:        title ?? null,
      release_year: releaseYear ?? null,
    }, { onConflict: "user_id,tmdb_id,media_type" });
  }

  async function syncAllAvailableEpisodes(mark: boolean, watchedAt = new Date().toISOString()) {
    if (!userId || !isTv) return;

    if (!mark) {
      await supabase
        .from("episode_progress")
        .delete()
        .eq("user_id", userId)
        .eq("tmdb_id", tmdbId);

      setSeriesProgress((prev) => ({ ...prev, watchedEpisodes: 0 }));
      emitSeriesBulkProgressUpdate({ tmdbId, action: "unmark-all" });
      return;
    }

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const availableEpisodes = seasons.flatMap((season) =>
      (season.episodes ?? [])
        .filter((episode) => episode.air_date ? new Date(episode.air_date) <= today : false)
        .map((episode) => ({
          user_id:    userId,
          tmdb_id:    tmdbId,
          season:     season.season_number,
          episode:    episode.episode_number,
          watched_at: watchedAt,
        })),
    );

    if (availableEpisodes.length === 0) {
      emitSeriesBulkProgressUpdate({ tmdbId, action: "mark-all", watchedAt });
      return;
    }

    await supabase.from("episode_progress").upsert(availableEpisodes, {
      onConflict: "user_id,tmdb_id,season,episode",
    });

    setSeriesProgress((prev) => ({
      ...prev,
      episodeCount: prev.episodeCount || availableEpisodes.length,
      watchedEpisodes: availableEpisodes.length,
    }));

    emitSeriesBulkProgressUpdate({ tmdbId, action: "mark-all", watchedAt });
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleWatchlist() {
    if (!requireAuth()) return;
    setLoading("watchlist");
    await save({ status: userTitle.status === "watchlist" ? null : "watchlist" });
    setLoading(null);
  }

  async function handleFavorite() {
    if (!requireAuth()) return;
    setLoading("favorite");
    const nextFavorite = !userTitle.favorite;
    await save({
      favorite:   nextFavorite,
      status:     !isTv && nextFavorite ? "watched" : userTitle.status,
      watched_at: !isTv && nextFavorite && !userTitle.watched_at
        ? new Date().toISOString()
        : userTitle.watched_at,
    });
    setLoading(null);
  }

  async function handleFridge() {
    if (!requireAuth()) return;
    setLoading("fridge");
    if (userTitle.status === "fridge") {
      await save({ status: currentWatchedEpisodes > 0 ? "watching" : null });
    } else {
      await save({ status: "fridge" });
    }
    setLoading(null);
  }

  async function handleWatched() {
    if (!requireAuth()) return;
    setLoading("watched");
    if (userTitle.status === "watched") {
      await save({ status: null, watched_at: null });
      setShowDatePicker(false);
    } else {
      await save({ status: "watched", watched_at: new Date().toISOString() });
    }
    setLoading(null);
  }

  function handleSeriesMainButton() {
    if (!requireAuth()) return;

    if (watchingActive) {
      setLoading("watched");
      save({ status: null, watched_at: null }).then(() => setLoading(null));
      return;
    }

    setShowSeriesMenu((prev) => !prev);
  }

  function handleGoToEpisodes() {
    setShowSeriesMenu(false);
    const episodesBtn = document.getElementById("tab-episodes");
    if (episodesBtn) {
      episodesBtn.scrollIntoView({ behavior: "smooth" });
      episodesBtn.click();
    } else {
      router.push(`/title/${mediaType}/${tmdbId}?tab=episodes&season=1`);
    }
  }

  async function handleWatchedAll() {
    setShowSeriesMenu(false);
    if (!requireAuth()) return;
    setLoading("conclude");

    const watchedAt = new Date().toISOString();
    await syncAllAvailableEpisodes(true, watchedAt);
    await save({ status: "watched", watched_at: watchedAt });

    setLoading(null);
  }

  async function handleMarkConcluded() {
    if (!requireAuth()) return;

    if (allWatched) {
      setLoading("conclude");
      await save({ status: "watched", watched_at: new Date().toISOString() });
      setLoading(null);
      return;
    }

    setShowConfirm(true);
  }

  async function handleConfirmConcluded() {
    setShowConfirm(false);
    setLoading("conclude");

    const watchedAt = new Date().toISOString();
    await syncAllAvailableEpisodes(true, watchedAt);
    await save({ status: "watched", watched_at: watchedAt });

    setLoading(null);
  }

  async function handleUndoConcluded() {
    if (!requireAuth()) return;
    setLoading("conclude");

    await syncAllAvailableEpisodes(false);
    await save({ status: null, watched_at: null });

    setLoading(null);
  }

  function handleEditDate() {
    setPickerDate(
      userTitle.watched_at
        ? toDateInputValue(new Date(userTitle.watched_at))
        : toDateInputValue(new Date())
    );
    setShowDatePicker(true);
  }

  async function handleSaveDate() {
    setShowDatePicker(false);
    await save({ watched_at: new Date(pickerDate + "T12:00:00").toISOString() });
  }

  // ── Estado derivado ──────────────────────────────────────────────────────────
  const currentEpisodeCount    = seriesProgress.episodeCount;
  const currentWatchedEpisodes = seriesProgress.watchedEpisodes;

  const isWatchlist = userTitle.status === "watchlist";
  const isWatched   = userTitle.status === "watched";
  const isFridge    = userTitle.status === "fridge";
  const isFavorite  = userTitle.favorite;

  const allWatched     = currentEpisodeCount > 0 && currentWatchedEpisodes >= currentEpisodeCount;
  const watchingActive = isTv && (userTitle.status === "watching" || (currentWatchedEpisodes > 0 && !isWatched));

  if (initialLoading) {
    if (inline) {
      return (
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-28 animate-pulse rounded-full bg-white/5" />
          ))}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-2xl bg-white/5" />
        ))}
      </div>
    );
  }

  // ── Inline (horizontal pills) render ──────────────────────────────────────
  if (inline) {
    const pillBase = "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition duration-200 disabled:cursor-not-allowed disabled:opacity-60";
    const pillOff  = "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/20 hover:bg-white/10 hover:text-white";

    return (
      <div ref={seriesMenuRef} className="w-full">
        <div className="flex flex-wrap justify-center gap-2 sm:justify-start">

          {/* Watchlist */}
          <button
            onClick={handleWatchlist}
            disabled={loading === "watchlist"}
            className={`${pillBase} ${isWatchlist ? "border-sky-400/50 bg-sky-400/15 text-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.18)]" : pillOff}`}
          >
            <IconBookmark filled={isWatchlist} />
            <span>{loading === "watchlist" ? "..." : isWatchlist ? "Na watchlist" : "Watchlist"}</span>
          </button>

          {/* Acompanhar série / Assistido filme */}
          {isTv ? (
            <button
              onClick={handleSeriesMainButton}
              disabled={loading === "watched" || loading === "conclude" || isWatched}
              className={`${pillBase} ${
                watchingActive
                  ? "border-sky-400/50 bg-sky-400/15 text-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.18)]"
                  : isWatched
                    ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.15)] cursor-default"
                    : pillOff
              }`}
            >
              {isWatched ? <IconCheck filled /> : <IconPlay />}
              <span>
                {loading === "watched" || loading === "conclude"
                  ? "..."
                  : isWatched
                    ? "Concluída"
                    : watchingActive
                      ? "Acompanhando"
                      : "Acompanhar"}
              </span>
              {watchingActive && currentEpisodeCount > 0 && (
                <span className="font-black text-sky-400">{currentWatchedEpisodes}/{currentEpisodeCount}</span>
              )}
              {!watchingActive && !isWatched && <IconChevron />}
            </button>
          ) : (
            <button
              onClick={handleWatched}
              disabled={loading === "watched"}
              className={`${pillBase} ${isWatched ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.18)]" : pillOff}`}
            >
              <IconCheck filled={isWatched} />
              <span>{loading === "watched" ? "..." : isWatched ? "Assistido" : "Marcar assistido"}</span>
            </button>
          )}

          {/* Favorito */}
          <button
            onClick={handleFavorite}
            disabled={loading === "favorite"}
            className={`${pillBase} ${isFavorite ? "border-amber-400/50 bg-amber-400/15 text-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.18)]" : pillOff}`}
          >
            <IconStar filled={isFavorite} />
            <span>{loading === "favorite" ? "..." : isFavorite ? "Favorito" : "Favoritar"}</span>
          </button>

          {/* Geladeira */}
          <button
            onClick={handleFridge}
            disabled={loading === "fridge"}
            className={`${pillBase} ${isFridge ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.15)]" : "border-white/[0.06] bg-white/[0.02] text-zinc-500 hover:border-white/10 hover:bg-white/[0.04] hover:text-zinc-300"}`}
          >
            <IconFridge filled={isFridge} />
            <span>{loading === "fridge" ? "..." : isFridge ? "Na geladeira" : "Geladeira"}</span>
          </button>

        </div>

        {/* Sub-controles (dropdown séries, data, modal) */}
        {isTv && showSeriesMenu && !watchingActive && !isWatched && (
          <div className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[#0e0e1a]">
            <button
              onClick={handleGoToEpisodes}
              className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
            >
              <IconPlay />
              <span>Marcar episódios assistidos</span>
            </button>
            <div className="mx-4 border-t border-white/[0.06]" />
            <button
              onClick={handleWatchedAll}
              className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/[0.06] hover:text-emerald-300"
            >
              <IconCheck filled={false} />
              <span>Já assisti tudo</span>
            </button>
          </div>
        )}

        {isTv && watchingActive && !isWatched && (
          <div className="mt-1.5 px-1">
            <button
              onClick={handleMarkConcluded}
              disabled={loading === "conclude"}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold text-slate-500 transition hover:bg-white/10 hover:text-emerald-300 disabled:opacity-50"
            >
              <IconCheck filled={false} />
              {loading === "conclude" ? "Salvando..." : "Marcar como concluída"}
            </button>
          </div>
        )}

        {isTv && isWatched && (
          <div className="mt-1.5 px-1">
            <button
              onClick={handleUndoConcluded}
              disabled={loading === "conclude"}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold text-slate-500 transition hover:bg-white/10 hover:text-slate-300 disabled:opacity-50"
            >
              ↩ Desfazer conclusão
            </button>
          </div>
        )}

        {showConfirm && (
          <ConfirmModal
            title="Marcar como concluída?"
            message={`Você assistiu ${currentWatchedEpisodes} de ${currentEpisodeCount || "?"} episódios. Deseja marcar "${title}" como concluída mesmo assim?`}
            onConfirm={handleConfirmConcluded}
            onCancel={() => setShowConfirm(false)}
          />
        )}

        {(isWatched || (!isTv && isWatched)) && userTitle.watched_at && !showDatePicker && (
          <div className="mt-1.5 flex items-center gap-1.5 px-1">
            <span className="text-[11px] text-slate-500">
              {isTv ? "Concluída" : "Assistido"} em {formatWatchedAt(userTitle.watched_at)}
            </span>
            <button
              onClick={handleEditDate}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-slate-500 transition hover:bg-white/10 hover:text-slate-300"
            >
              <IconPencil />
              editar
            </button>
          </div>
        )}

        {showDatePicker && (
          <div className="mt-2 rounded-2xl border border-white/10 bg-[#0e0e1a] p-4">
            <p className="mb-3 text-xs font-bold text-slate-300">
              {isTv ? "Quando você concluiu?" : "Quando você assistiu?"}
            </p>
            <input
              type="date"
              value={pickerDate}
              max={toDateInputValue(new Date())}
              onChange={(e) => setPickerDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-400/60 [color-scheme:dark]"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleSaveDate}
                className="flex-1 rounded-xl bg-white py-2 text-sm font-bold text-black transition hover:bg-sky-100"
              >
                Salvar
              </button>
              <button
                onClick={() => setShowDatePicker(false)}
                className="flex-1 rounded-xl border border-white/10 py-2 text-sm font-bold text-slate-400 transition hover:text-white"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Sidebar (vertical card) render ────────────────────────────────────────
  return (
    <div className="rounded-[1.65rem] border border-white/10 bg-white/[0.04] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl">

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
          Minha lista
        </h2>
        {!userId && (
          <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold text-slate-400">
            Faça login
          </span>
        )}
      </div>

      <div className="space-y-2">

        {/* Watchlist */}
        <button
          onClick={handleWatchlist}
          disabled={loading === "watchlist"}
          className={`group flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-sm font-bold transition duration-200
            ${isWatchlist
              ? "border-sky-400/50 bg-sky-400/15 text-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.18)] hover:bg-sky-400/20"
              : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/20 hover:bg-white/10 hover:text-white"
            } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <IconBookmark filled={isWatchlist} />
          <span className="flex-1 text-left">
            {loading === "watchlist" ? "Salvando..." : isWatchlist ? "Na watchlist" : "Adicionar à watchlist"}
          </span>
          {isWatchlist && (
            <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-sky-400">ativo</span>
          )}
        </button>

        {/* Acompanhar série / Assistido filme */}
        <div ref={seriesMenuRef} className="relative">
          {isTv ? (
            <>
              <button
                onClick={handleSeriesMainButton}
                disabled={loading === "watched" || loading === "conclude" || isWatched}
                className={`group flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-sm font-bold transition duration-200
                  ${watchingActive
                    ? "border-sky-400/50 bg-sky-400/15 text-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.18)] hover:bg-sky-400/20"
                    : isWatched
                      ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.15)] cursor-default"
                      : showSeriesMenu
                        ? "border-white/20 bg-white/10 text-white"
                        : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/20 hover:bg-white/10 hover:text-white"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {isWatched ? <IconCheck filled /> : <IconPlay />}
                <span className="flex-1 text-left">
                  {loading === "watched" || loading === "conclude"
                    ? "Salvando..."
                    : isWatched
                      ? "Série concluída"
                      : watchingActive
                        ? "Acompanhando"
                        : "Acompanhar série"}
                </span>
                {watchingActive && currentEpisodeCount > 0 && (
                  <span className="shrink-0 text-[10px] font-black text-sky-400">
                    {currentWatchedEpisodes}/{currentEpisodeCount}
                  </span>
                )}
                {watchingActive && (
                  <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-sky-400">ativo</span>
                )}
                {!watchingActive && !isWatched && (
                  <span className={`shrink-0 transition-transform duration-200 ${showSeriesMenu ? "rotate-180" : ""}`}>
                    <IconChevron />
                  </span>
                )}
              </button>

              {showSeriesMenu && !watchingActive && !isWatched && (
                <div className="mt-1.5 overflow-hidden rounded-2xl border border-white/10 bg-[#0e0e1a]">
                  <button
                    onClick={handleGoToEpisodes}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    <IconPlay />
                    <span className="text-left">Marcar episódios assistidos</span>
                  </button>
                  <div className="mx-4 border-t border-white/[0.06]" />
                  <button
                    onClick={handleWatchedAll}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/[0.06] hover:text-emerald-300"
                  >
                    <IconCheck filled={false} />
                    <span className="text-left">Já assisti tudo</span>
                  </button>
                </div>
              )}

              {watchingActive && !isWatched && (
                <div className="mt-1.5 px-1">
                  <button
                    onClick={handleMarkConcluded}
                    disabled={loading === "conclude"}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold text-slate-500 transition hover:bg-white/10 hover:text-emerald-300 disabled:opacity-50"
                  >
                    <IconCheck filled={false} />
                    {loading === "conclude" ? "Salvando..." : "Marcar como concluída"}
                  </button>
                </div>
              )}

              {isWatched && (
                <div className="mt-1.5 px-1">
                  <button
                    onClick={handleUndoConcluded}
                    disabled={loading === "conclude"}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold text-slate-500 transition hover:bg-white/10 hover:text-slate-300 disabled:opacity-50"
                  >
                    ↩ Desfazer conclusão
                  </button>
                </div>
              )}

              {showConfirm && (
                <ConfirmModal
                  title="Marcar como concluída?"
                  message={`Você assistiu ${currentWatchedEpisodes} de ${currentEpisodeCount || "?"} episódios. Deseja marcar "${title}" como concluída mesmo assim?`}
                  onConfirm={handleConfirmConcluded}
                  onCancel={() => setShowConfirm(false)}
                />
              )}

              {isWatched && userTitle.watched_at && !showDatePicker && (
                <div className="mt-1.5 flex items-center gap-1.5 px-4">
                  <span className="text-[11px] text-slate-500">
                    Concluída em {formatWatchedAt(userTitle.watched_at)}
                  </span>
                  <button
                    onClick={handleEditDate}
                    className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-slate-500 transition hover:bg-white/10 hover:text-slate-300"
                  >
                    <IconPencil />
                    editar
                  </button>
                </div>
              )}
            </>
          ) : (
            <button
              onClick={handleWatched}
              disabled={loading === "watched"}
              className={`group flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-sm font-bold transition duration-200
                ${isWatched
                  ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.18)] hover:bg-emerald-400/20"
                  : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/20 hover:bg-white/10 hover:text-white"
                } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <IconCheck filled={isWatched} />
              <span className="flex-1 text-left">
                {loading === "watched" ? "Salvando..." : isWatched ? "Já assistido" : "Marcar como assistido"}
              </span>
              {isWatched && (
                <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-emerald-400">ativo</span>
              )}
            </button>
          )}

          {!isTv && isWatched && userTitle.watched_at && !showDatePicker && (
            <div className="mt-1.5 flex items-center gap-1.5 px-4">
              <span className="text-[11px] text-slate-500">
                Assistido em {formatWatchedAt(userTitle.watched_at)}
              </span>
              <button
                onClick={handleEditDate}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-slate-500 transition hover:bg-white/10 hover:text-slate-300"
              >
                <IconPencil />
                editar
              </button>
            </div>
          )}

          {showDatePicker && (
            <div className="mt-2 rounded-2xl border border-white/10 bg-[#0e0e1a] p-4">
              <p className="mb-3 text-xs font-bold text-slate-300">
                {isTv ? "Quando você concluiu?" : "Quando você assistiu?"}
              </p>
              <input
                type="date"
                value={pickerDate}
                max={toDateInputValue(new Date())}
                onChange={(e) => setPickerDate(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-400/60 [color-scheme:dark]"
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleSaveDate}
                  className="flex-1 rounded-xl bg-white py-2 text-sm font-bold text-black transition hover:bg-sky-100"
                >
                  Salvar
                </button>
                <button
                  onClick={() => setShowDatePicker(false)}
                  className="flex-1 rounded-xl border border-white/10 py-2 text-sm font-bold text-slate-400 transition hover:text-white"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Favorito */}
        <button
          onClick={handleFavorite}
          disabled={loading === "favorite"}
          className={`group flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-sm font-bold transition duration-200
            ${isFavorite
              ? "border-amber-400/50 bg-amber-400/15 text-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.18)] hover:bg-amber-400/20"
              : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/20 hover:bg-white/10 hover:text-white"
            } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <IconStar filled={isFavorite} />
          <span className="flex-1 text-left">
            {loading === "favorite" ? "Salvando..." : isFavorite ? "Nos favoritos" : "Adicionar aos favoritos"}
          </span>
          {isFavorite && (
            <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-amber-400">ativo</span>
          )}
        </button>

        {/* Geladeira */}
        <button
          onClick={handleFridge}
          disabled={loading === "fridge"}
          className={`group flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-sm font-bold transition duration-200
            ${isFridge
              ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.15)] hover:bg-cyan-400/15"
              : "border-white/[0.06] bg-white/[0.02] text-zinc-500 hover:border-white/10 hover:bg-white/[0.04] hover:text-zinc-300"
            } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <IconFridge filled={isFridge} />
          <span className="flex-1 text-left">
            {loading === "fridge" ? "Salvando..." : isFridge ? "Na geladeira" : "Colocar na geladeira"}
          </span>
          {isFridge && (
            <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-cyan-400">ativo</span>
          )}
        </button>

      </div>
    </div>
  );
}

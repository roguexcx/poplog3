"use client";
// src/features/title/TitleTabs.tsx

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import type { TMDBSeason, TMDBEpisode } from "@/features/title/title-types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "overview" | "episodes";

type EpisodeProgress = {
  season: number;
  episode: number;
  watched_at: string;
};

type Props = {
  type: string;
  overviewContent: React.ReactNode;
  seasons: TMDBSeason[];
  tmdbId: number;
  mediaType: "movie" | "tv";
};

type SeriesProgressEventDetail = {
  tmdbId: number;
  episodeCount: number;
  watchedEpisodes: number;
};

type SeriesBulkProgressEventDetail = {
  tmdbId: number;
  action: "mark-all" | "unmark-all";
  watchedAt?: string;
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

function formatRuntime(minutes: number | null): string {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function getTotalEpisodes(seasons: TMDBSeason[]): number {
  return seasons.reduce((total, season) => {
    return total + (season.episodes?.length ?? season.episode_count ?? 0);
  }, 0);
}

function emitSeriesProgressUpdate(detail: SeriesProgressEventDetail) {
  window.dispatchEvent(new CustomEvent("poplog:series-progress", { detail }));
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

// ─── DatePicker inline ────────────────────────────────────────────────────────

function DatePicker({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (iso: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="mt-2 rounded-2xl border border-white/10 bg-[#0e0e1a] p-3">
      <p className="mb-2 text-xs font-bold text-zinc-300">Quando você assistiu?</p>
      <input
        type="date"
        value={value}
        max={toDateInputValue(new Date())}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/60 [color-scheme:dark]"
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => onSave(new Date(value + "T12:00:00").toISOString())}
          className="flex-1 rounded-xl bg-white py-1.5 text-xs font-bold text-black transition hover:bg-sky-100"
        >
          Salvar
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-xl border border-white/10 py-1.5 text-xs font-bold text-zinc-400 transition hover:text-white"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── EpisodeRow ───────────────────────────────────────────────────────────────

function EpisodeRow({
  episode,
  seasonNumber,
  progress,
  saving,
  isAvailable,
  onToggle,
  onDateSave,
}: {
  episode: TMDBEpisode;
  seasonNumber: number;
  progress: EpisodeProgress | undefined;
  saving: boolean;
  isAvailable: boolean;
  onToggle: (season: number, ep: number) => void;
  onDateSave: (season: number, ep: number, iso: string) => void;
}) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const isWatched = Boolean(progress);

  const airDateLabel = episode.air_date
    ? new Date(episode.air_date).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className={`rounded-2xl border p-3 transition ${
      isAvailable
        ? `border-white/10 bg-white/[0.03] hover:bg-white/[0.05] ${saving ? "pointer-events-none opacity-50" : ""}`
        : "border-white/5 bg-white/[0.01] opacity-50"
    }`}>
      <div className="flex items-center gap-3">

        {/* Thumbnail */}
        <div className="relative h-[54px] w-24 shrink-0 overflow-hidden rounded-xl bg-white/5">
          {episode.still_path && isAvailable ? (
            <Image
              src={`https://image.tmdb.org/t/p/w300${episode.still_path}`}
              alt={episode.name}
              fill
              sizes="96px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-[10px] text-zinc-600">
                {isAvailable ? `T${seasonNumber}E${episode.episode_number}` : "🔒"}
              </span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 text-[10px] font-black text-zinc-500">
              E{episode.episode_number}
            </span>
            <p className={`truncate text-sm font-bold ${
              !isAvailable ? "text-zinc-600" : isWatched ? "text-zinc-300" : "text-zinc-100"
            }`}>
              {episode.name}
            </p>
          </div>

          {isAvailable && (
            <>
              {episode.runtime && (
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {formatRuntime(episode.runtime)}
                </p>
              )}
              {episode.overview && (
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-500">
                  {episode.overview}
                </p>
              )}
              {isWatched && progress?.watched_at && !showDatePicker && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-600">
                    {formatWatchedAt(progress.watched_at)}
                  </span>
                  <button
                    onClick={() => setShowDatePicker(true)}
                    className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] text-zinc-600 transition hover:bg-white/10 hover:text-zinc-400"
                  >
                    <IconPencil />
                    editar
                  </button>
                </div>
              )}
            </>
          )}

          {!isAvailable && airDateLabel && (
            <p className="mt-0.5 text-[11px] text-zinc-600">
              Estreia em {airDateLabel}
            </p>
          )}
        </div>

        {/* Checkbox */}
        {isAvailable ? (
          <button
            onClick={() => onToggle(seasonNumber, episode.episode_number)}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition duration-200 ${
              isWatched
                ? "border-emerald-400/60 bg-emerald-400/20 text-emerald-300"
                : "border-white/15 text-transparent hover:border-emerald-400/40 hover:bg-white/5"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        ) : (
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/5 text-zinc-700">
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        )}
      </div>

      {isAvailable && showDatePicker && (
        <DatePicker
          initial={
            progress?.watched_at
              ? toDateInputValue(new Date(progress.watched_at))
              : toDateInputValue(new Date())
          }
          onSave={(iso) => {
            onDateSave(seasonNumber, episode.episode_number, iso);
            setShowDatePicker(false);
          }}
          onCancel={() => setShowDatePicker(false)}
        />
      )}
    </div>
  );
}

// ─── EpisodesTab ──────────────────────────────────────────────────────────────

function EpisodesTab({
  seasons,
  tmdbId,
  userId,
  initialSeason,
}: {
  seasons: TMDBSeason[];
  tmdbId: number;
  userId: string | null;
  initialSeason?: number;
}) {
  const supabase = createClient();

  const resolvedInitialSeason =
    initialSeason && seasons.some((s) => s.season_number === initialSeason)
      ? initialSeason
      : seasons[0]?.season_number ?? 1;

  const [activeSeason, setActiveSeason] = useState(resolvedInitialSeason);
  const [progress, setProgress]         = useState<EpisodeProgress[]>([]);
  const [savingEps, setSavingEps]       = useState<Set<string>>(new Set());
  const [markingAll, setMarkingAll]     = useState(false);

  const currentSeason  = seasons.find((s) => s.season_number === activeSeason);
  const episodeCount   = getTotalEpisodes(seasons);

  async function syncSeriesProgress(nextProgress: EpisodeProgress[]) {
    const watchedEpisodes = nextProgress.length;
    emitSeriesProgressUpdate({ tmdbId, episodeCount, watchedEpisodes });

    if (!userId) return;

    if (watchedEpisodes === 0) {
      const { data: currentTitle } = await supabase
        .from("user_titles")
        .select("status")
        .eq("user_id", userId)
        .eq("tmdb_id", tmdbId)
        .eq("media_type", "tv")
        .maybeSingle();

      if (!currentTitle || currentTitle.status === "watched") {
        await supabase
          .from("user_titles")
          .update({ status: null, watched_at: null })
          .eq("user_id", userId)
          .eq("tmdb_id", tmdbId)
          .eq("media_type", "tv");
      }
      return;
    }

    if (episodeCount > 0 && watchedEpisodes >= episodeCount) {
      await supabase.from("user_titles").upsert(
        { user_id: userId, tmdb_id: tmdbId, media_type: "tv", status: "watched", watched_at: new Date().toISOString() },
        { onConflict: "user_id,tmdb_id,media_type" },
      );
      return;
    }

    await supabase.from("user_titles").upsert(
      { user_id: userId, tmdb_id: tmdbId, media_type: "tv", status: "watching", watched_at: null },
      { onConflict: "user_id,tmdb_id,media_type" },
    );
  }

  useEffect(() => {
    if (!userId) return;
    supabase
      .from("episode_progress")
      .select("season, episode, watched_at")
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
      .then(({ data }) => {
        if (data) {
          const loadedProgress = data as EpisodeProgress[];
          setProgress(loadedProgress);
          emitSeriesProgressUpdate({ tmdbId, episodeCount, watchedEpisodes: loadedProgress.length });
        }
      });
  }, [userId, tmdbId, episodeCount]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleBulkProgressEvent(event: Event) {
      const customEvent = event as CustomEvent<SeriesBulkProgressEventDetail>;
      if (customEvent.detail.tmdbId !== tmdbId) return;

      if (customEvent.detail.action === "unmark-all") {
        setProgress([]);
        emitSeriesProgressUpdate({ tmdbId, episodeCount, watchedEpisodes: 0 });
        return;
      }

      const todayMark = new Date();
      todayMark.setHours(23, 59, 59, 999);
      const watchedAt = customEvent.detail.watchedAt ?? new Date().toISOString();

      const nextProgress = seasons.flatMap((season) =>
        (season.episodes ?? [])
          .filter((ep) => (ep.air_date ? new Date(ep.air_date) <= todayMark : false))
          .map((ep) => ({
            season: season.season_number,
            episode: ep.episode_number,
            watched_at: watchedAt,
          })),
      );

      setProgress(nextProgress);
      emitSeriesProgressUpdate({ tmdbId, episodeCount, watchedEpisodes: nextProgress.length });
    }

    window.addEventListener("poplog:series-bulk-progress", handleBulkProgressEvent);
    return () => window.removeEventListener("poplog:series-bulk-progress", handleBulkProgressEvent);
  }, [tmdbId, seasons, episodeCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const isWatched = useCallback(
    (season: number, ep: number) => progress.some((p) => p.season === season && p.episode === ep),
    [progress],
  );

  const getProgress = useCallback(
    (season: number, ep: number) => progress.find((p) => p.season === season && p.episode === ep),
    [progress],
  );

  async function handleToggle(season: number, ep: number) {
    if (!userId) return;
    const key = `${season}-${ep}`;
    setSavingEps((prev) => new Set(prev).add(key));

    if (isWatched(season, ep)) {
      await supabase
        .from("episode_progress")
        .delete()
        .eq("user_id", userId)
        .eq("tmdb_id", tmdbId)
        .eq("season", season)
        .eq("episode", ep);

      const nextProgress = progress.filter((p) => !(p.season === season && p.episode === ep));
      setProgress(nextProgress);
      await syncSeriesProgress(nextProgress);
    } else {
      const watched_at = new Date().toISOString();
      await supabase.from("episode_progress").upsert(
        { user_id: userId, tmdb_id: tmdbId, season, episode: ep, watched_at },
        { onConflict: "user_id,tmdb_id,season,episode" },
      );

      const nextProgress = [
        ...progress.filter((p) => !(p.season === season && p.episode === ep)),
        { season, episode: ep, watched_at },
      ];
      setProgress(nextProgress);
      await syncSeriesProgress(nextProgress);
    }

    setSavingEps((prev) => {
      const s = new Set(prev);
      s.delete(key);
      return s;
    });
  }

  async function handleDateSave(season: number, ep: number, iso: string) {
    if (!userId) return;
    await supabase.from("episode_progress").upsert(
      { user_id: userId, tmdb_id: tmdbId, season, episode: ep, watched_at: iso },
      { onConflict: "user_id,tmdb_id,season,episode" },
    );
    setProgress((prev) =>
      prev.map((p) => p.season === season && p.episode === ep ? { ...p, watched_at: iso } : p),
    );
  }

  async function handleMarkSeason(season: TMDBSeason, mark: boolean) {
    if (!userId || !season.episodes) return;
    setMarkingAll(true);

    const todayMark = new Date();
    todayMark.setHours(23, 59, 59, 999);
    const availableToMark = season.episodes.filter((ep) =>
      ep.air_date ? new Date(ep.air_date) <= todayMark : false
    );

    if (mark) {
      const now  = new Date().toISOString();
      const rows = availableToMark.map((ep) => ({
        user_id:    userId,
        tmdb_id:    tmdbId,
        season:     season.season_number,
        episode:    ep.episode_number,
        watched_at: now,
      }));
      await supabase
        .from("episode_progress")
        .upsert(rows, { onConflict: "user_id,tmdb_id,season,episode" });

      const nextProgress = [
        ...progress.filter((p) => p.season !== season.season_number),
        ...availableToMark.map((ep) => ({
          season:     season.season_number,
          episode:    ep.episode_number,
          watched_at: now,
        })),
      ];
      setProgress(nextProgress);
      await syncSeriesProgress(nextProgress);
    } else {
      await supabase
        .from("episode_progress")
        .delete()
        .eq("user_id", userId)
        .eq("tmdb_id", tmdbId)
        .eq("season", season.season_number);

      const nextProgress = progress.filter((p) => p.season !== season.season_number);
      setProgress(nextProgress);
      await syncSeriesProgress(nextProgress);
    }

    setMarkingAll(false);
  }

  if (!seasons.length) {
    return <p className="text-sm text-zinc-500">Nenhuma temporada disponível.</p>;
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const seasonEps    = currentSeason?.episodes ?? [];
  const availableEps = seasonEps.filter((ep) => ep.air_date ? new Date(ep.air_date) <= today : false);
  const futureEps    = seasonEps.filter((ep) => ep.air_date ? new Date(ep.air_date) > today : true);

  const watchedInSeason = availableEps.filter((ep) => isWatched(activeSeason, ep.episode_number)).length;
  const totalInSeason   = availableEps.length;
  const pct             = totalInSeason > 0 ? Math.round((watchedInSeason / totalInSeason) * 100) : 0;
  const allSeasonDone   = totalInSeason > 0 && watchedInSeason === totalInSeason;

  const lastWatchedDate = progress
    .filter((p) => p.season === activeSeason)
    .sort((a, b) => new Date(b.watched_at).getTime() - new Date(a.watched_at).getTime())[0]
    ?.watched_at;

  return (
    <div className="space-y-5">

      {/* Seletor de temporada */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar sm:mx-0 sm:flex-wrap sm:px-0">
        {seasons.map((season) => {
          const todayCheck = new Date();
          todayCheck.setHours(23, 59, 59, 999);
          const sAvailable = (season.episodes ?? []).filter((ep) =>
            ep.air_date ? new Date(ep.air_date) <= todayCheck : false
          ).length;
          const sTotal   = sAvailable || (season.episodes?.length ?? season.episode_count);
          const sWatched = progress.filter((p) => p.season === season.season_number).length;
          const sDone    = sAvailable > 0 && sWatched >= sAvailable;
          return (
            <button
              key={season.season_number}
              onClick={() => setActiveSeason(season.season_number)}
              className={`shrink-0 rounded-full border px-4 py-1.5 text-xs font-bold transition ${
                activeSeason === season.season_number
                  ? "border-sky-400/50 bg-sky-400/15 text-sky-300"
                  : "border-white/10 bg-white/[0.04] text-zinc-400 hover:border-white/20 hover:text-white"
              }`}
            >
              {season.name ?? `T${season.season_number}`}
              {sDone
                ? <span className="ml-1.5 text-emerald-400">✓</span>
                : sWatched > 0
                  ? <span className="ml-1.5 text-sky-400">{sWatched}/{sTotal}</span>
                  : null
              }
            </button>
          );
        })}
      </div>

      {/* Card da temporada */}
      {currentSeason && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-black text-zinc-200">{currentSeason.name}</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {totalInSeason} disponíveis
                {futureEps.length > 0 && (
                  <span className="ml-1 text-zinc-600">· {futureEps.length} em breve</span>
                )}
                {currentSeason.air_date && (
                  <> · {new Date(currentSeason.air_date).getFullYear()}</>
                )}
                {lastWatchedDate && (
                  <> · último em {formatWatchedAt(lastWatchedDate)}</>
                )}
              </p>
            </div>

            {userId && (
              <button
                onClick={() => handleMarkSeason(currentSeason, !allSeasonDone)}
                disabled={markingAll}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-50 ${
                  allSeasonDone
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                    : "border-white/10 bg-white/[0.04] text-zinc-400 hover:border-sky-400/40 hover:text-sky-300"
                }`}
              >
                {markingAll ? "Salvando..." : allSeasonDone ? "✓ Temporada vista" : "Marcar temporada"}
              </button>
            )}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-sky-400 transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 text-[11px] font-bold text-zinc-500">
              {watchedInSeason}/{totalInSeason}
            </span>
          </div>
        </div>
      )}

      {/* Selecionar todos */}
      {userId && totalInSeason > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-600">
            {watchedInSeason} de {totalInSeason} disponíveis vistos
          </span>
          <button
            onClick={() => currentSeason && handleMarkSeason(currentSeason, !allSeasonDone)}
            disabled={markingAll}
            className="text-[11px] font-bold text-zinc-500 transition hover:text-sky-300 disabled:opacity-50"
          >
            {allSeasonDone ? "Desmarcar todos" : "Marcar disponíveis"}
          </button>
        </div>
      )}

      {/* Lista de episódios */}
      {currentSeason?.episodes && (
        <div className="space-y-2">
          {currentSeason.episodes.map((ep) => {
            const epAvailable = ep.air_date ? new Date(ep.air_date) <= today : false;
            return (
              <EpisodeRow
                key={ep.id}
                episode={ep}
                seasonNumber={activeSeason}
                progress={getProgress(activeSeason, ep.episode_number)}
                saving={savingEps.has(`${activeSeason}-${ep.episode_number}`)}
                isAvailable={epAvailable}
                onToggle={handleToggle}
                onDateSave={handleDateSave}
              />
            );
          })}
        </div>
      )}

      {!userId && (
        <p className="text-center text-sm text-zinc-600">
          <a href="/login" className="text-sky-400 hover:text-sky-300">Faça login</a>{" "}
          para marcar episódios.
        </p>
      )}
    </div>
  );
}

// ─── TitleTabsInner ───────────────────────────────────────────────────────────

function TitleTabsInner({
  type,
  overviewContent,
  seasons,
  tmdbId,
  userId,
}: Omit<Props, "mediaType"> & { userId: string | null }) {
  const searchParams = useSearchParams();
  const isTv = type === "tv";

  const tabParam     = searchParams.get("tab");
  const seasonParam  = searchParams.get("season");
  const initialSeason = seasonParam ? parseInt(seasonParam, 10) : undefined;

  const [activeTab, setActiveTab] = useState<Tab>(
    tabParam === "episodes" && isTv ? "episodes" : "overview"
  );

  const tabs: { key: Tab; label: string }[] = isTv
    ? [
        { key: "overview",  label: "Visão geral" },
        { key: "episodes",  label: "Episódios" },
      ]
    : [];

  return (
    <div>
      {tabs.length > 1 && (
        <div className="mb-7 flex gap-1 overflow-x-auto border-b border-white/10 no-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              id={tab.key === "episodes" ? "tab-episodes" : undefined}
              onClick={() => setActiveTab(tab.key)}
              className={`shrink-0 -mb-px border-b-2 px-5 py-3 text-[11px] font-black uppercase tracking-[0.25em] transition ${
                activeTab === tab.key
                  ? "border-sky-400 text-sky-300"
                  : "border-transparent text-zinc-500 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {activeTab === "overview" && overviewContent}
      {activeTab === "episodes" && (
        <EpisodesTab
          seasons={seasons}
          tmdbId={tmdbId}
          userId={userId}
          initialSeason={initialSeason}
        />
      )}
    </div>
  );
}

// ─── Component principal ──────────────────────────────────────────────────────

export default function TitleTabs(props: Props) {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
    });
  }, []);

  return (
    <Suspense fallback={
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-2xl bg-white/5" />
        ))}
      </div>
    }>
      <TitleTabsInner {...props} userId={userId} />
    </Suspense>
  );
}

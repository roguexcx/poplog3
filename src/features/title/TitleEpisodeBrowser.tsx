"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import Image from "next/image";
import { resolveForRender } from "@/lib/images/proxy";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, } from "react";
import StarRating from "@/components/ui/StarRating";
import SectionHeader from "@/components/ui/SectionHeader";
import { formatRuntimeLabel } from "@/lib/domain-labels";
import { useUserRating } from "@/hooks/useUserRating";
import { useInterfaceMessages } from "@/hooks/useInterfaceMessages";
import { dispatchLibraryStatusChanged as dispatchGlobalLibraryStatusChanged, dispatchSeriesProgressRefresh, episodeKey, postEpisodeProgress, } from "./episodeProgressClient";
import type { TitleSeasonInfo, TitleSeriesProgress } from "./types";
import type { CommunityRatingData } from "@/types/user";
type EpisodeDto = {
    episodeNumber: number;
    name: string | null;
    overview: string | null;
    stillUrl: string | null;
    airDate: string | null;
    runtime: number | null;
    voteAverage: number | null;
    voteCount: number | null;
    episodeType: string | null;
};
type SeasonDto = {
    seriesTmdbId: number | string;
    seasonNumber: number;
    name: string | null;
    overview: string | null;
    posterUrl: string | null;
    airDate: string | null;
    episodeCount: number | null;
    voteAverage: number | null;
    lastSyncedAt: string | null;
    episodes: EpisodeDto[];
};
type TitleEpisodeBrowserProps = {
    /** ID used to fetch season/episode data from the season API. Accepts positive tmdbId, imdbId string, or poplogId. */
    seriesTmdbId: number | string;
    /** Numeric ID used for episode progress tracking (positive tmdbId or synthetic negative). Falls back to seriesTmdbId if numeric. */
    progressSeriesId?: number | null;
    seriesName?: string | null;
    seasons: TitleSeasonInfo[];
    initialSeason?: number | null;
    initialProgress?: TitleSeriesProgress | null;
    isAuthenticated?: boolean;
    onSeriesCommunityRatingChange?: (rating: CommunityRatingData | null) => void;
};
type ActiveEpisode = {
    seasonNumber: number;
    episode: EpisodeDto;
};
type EpisodeCommentDto = {
    id: number | string;
    originalComment?: string | null;
    translatedComment?: string | null;
    displayComment?: string | null;
    translationStatus?: string | null;
    spoiler?: boolean;
    review?: boolean;
    replies?: number;
    likes?: number;
    user?: {
        username?: string | null;
        vip?: boolean;
        verified?: boolean;
    } | null;
};
type EpisodeCommentsResponse = {
    source?: string;
    tmdbId?: number;
    season?: number;
    episode?: number;
    total?: number;
    comments?: EpisodeCommentDto[];
    error?: string;
};
type CachedEpisodeComments = {
    total: number;
    comments: EpisodeCommentDto[];
};
const EPISODES_PER_PAGE = 24;
function formatAirDate(date: string | null) {
    if (!date)
        return null;
    const d = new Date(date);
    if (!Number.isFinite(d.getTime()))
        return null;
    return d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}
function getOriginalTmdbImageUrl(url: string | null) {
    if (!url)
        return null;
    return url.replace(/\/t\/p\/[^/]+\//, "/t/p/original/");
}
export default function TitleEpisodeBrowser({ seriesTmdbId, progressSeriesId, seriesName, seasons, initialSeason, initialProgress, isAuthenticated = false, onSeriesCommunityRatingChange, }: TitleEpisodeBrowserProps) {
    const { t } = useInterfaceMessages();
    // Numeric ID for dispatch/progress. Prefer explicit progressSeriesId (incl. synthetic negatives),
    // fall back to seriesTmdbId when it's already a number, or 0 when only a string is available.
    const numericSeriesId = typeof progressSeriesId === "number" && progressSeriesId !== 0
        ? progressSeriesId
        : typeof seriesTmdbId === "number"
            ? seriesTmdbId
            : 0;
    const seasonNumbers = useMemo(() => seasons.map((s) => s.seasonNumber), [seasons]);
    const [selected, setSelected] = useState<number | null>(() => {
        if (seasons.length === 0)
            return null;
        if (typeof initialSeason === "number" &&
            seasonNumbers.includes(initialSeason)) {
            return initialSeason;
        }
        // Sem progresso do usuário: começa na primeira temporada regular (S01)
        const firstRegular = seasons.find((s) => s.seasonNumber > 0);
        if (firstRegular)
            return firstRegular.seasonNumber;
        return seasonNumbers[0] ?? null;
    });
    const [season, setSeason] = useState<SeasonDto | null>(null);
    const [activeEpisode, setActiveEpisode] = useState<ActiveEpisode | null>(null);
    const [commentsCache, setCommentsCache] = useState<Record<string, CachedEpisodeComments>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [visibleCount, setVisibleCount] = useState(EPISODES_PER_PAGE);
    const seasonCacheRef = useRef<Map<number, SeasonDto>>(new Map());
    const [watchedKeys, setWatchedKeys] = useState<Set<string>>(() => new Set(initialProgress?.watchedKeys ?? []));
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [seasonSaving, setSeasonSaving] = useState(false);
    const [, startTransition] = useTransition();
    type PendingPrevDialog = {
        seasonNumber: number;
        episodeNumber: number;
        runtimeMinutes: number | null;
        prevEpisodes: Array<{
            episodeNumber: number;
            runtimeMinutes: number | null;
        }>;
    };
    const [pendingPrevDialog, setPendingPrevDialog] = useState<PendingPrevDialog | null>(null);
    const handleCacheComments = useCallback((cacheKey: string, payload: CachedEpisodeComments) => {
        setCommentsCache((prev) => ({
            ...prev,
            [cacheKey]: payload,
        }));
    }, []);
    useEffect(() => {
        if (selected === null)
            return;
        // Validação defensiva: aceita string (imdbId/slug), número positivo ou negativo sintético
        if (typeof seriesTmdbId === "number" && (!Number.isFinite(seriesTmdbId) || seriesTmdbId === 0)) {
            console.error("[TitleEpisodeBrowser] Invalid seriesTmdbId", {
                seriesTmdbId,
                type: typeof seriesTmdbId,
            });
            setError(uiMessage("ui.b83db2d50188"));
            setSeason(null);
            return;
        }
        const cachedSeason = seasonCacheRef.current.get(selected);
        if (cachedSeason) {
            setSeason(cachedSeason);
            setLoading(false);
            setError(null);
            setVisibleCount(EPISODES_PER_PAGE);
            setActiveEpisode(null);
            return;
        }
        const controller = new AbortController();
        let cancelled = false;
        setLoading(true);
        setError(null);
        setSeason(null);
        setVisibleCount(EPISODES_PER_PAGE);
        setActiveEpisode(null);
        fetch(`/api/poplog3/tv/${seriesTmdbId}/seasons/${selected}`, {
            signal: controller.signal,
        })
            .then(async (res) => {
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            return (await res.json()) as SeasonDto;
        })
            .then((data) => {
            if (cancelled)
                return;
            seasonCacheRef.current.set(selected, data);
            setSeason(data);
        })
            .catch((err) => {
            if (cancelled)
                return;
            if (err instanceof DOMException && err.name === "AbortError")
                return;
            setError(err instanceof Error ? err.message : "Erro desconhecido");
            setSeason(null);
        })
            .finally(() => {
            if (cancelled)
                return;
            setLoading(false);
        });
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [seriesTmdbId, selected]);
    useEffect(() => {
        async function refreshProgress(event: Event) {
            const customEvent = event as CustomEvent<{
                seriesTmdbId?: number | string;
            }>;
            if (customEvent.detail?.seriesTmdbId !== numericSeriesId)
                return;
            try {
                const res = await fetch(`/api/poplog3/series/${numericSeriesId}/progress`);
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const body = (await res.json()) as {
                    ok?: boolean;
                    progress?: {
                        watchedKeys?: string[];
                    };
                    watchedKeys?: string[];
                };
                const nextKeys = body.progress?.watchedKeys ?? body.watchedKeys ?? [];
                setWatchedKeys(new Set(nextKeys));
            }
            catch (err) {
                console.warn("[series progress refresh] erro:", err);
            }
        }
        window.addEventListener("poplog3:series-progress-refresh", refreshProgress);
        return () => {
            window.removeEventListener("poplog3:series-progress-refresh", refreshProgress);
        };
    }, [seriesTmdbId, numericSeriesId]);
    useEffect(() => {
        if (!activeEpisode)
            return;
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setActiveEpisode(null);
            }
        }
        document.addEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "";
        };
    }, [activeEpisode]);
    if (seasons.length === 0 || selected === null) {
        return null;
    }
    const selectedMeta = seasons.find((s) => s.seasonNumber === selected) ?? null;
    const subtitle = season?.name && !/^season\s+\d+$/i.test(season.name)
        ? season.name
        : selectedMeta?.name && !/^season\s+\d+$/i.test(selectedMeta.name)
            ? selectedMeta.name
            : undefined;
    const visibleEpisodes = season?.episodes.slice(0, visibleCount) ?? [];
    const hasMoreEpisodes = Boolean(season) && visibleCount < (season?.episodes.length ?? 0);
    function dispatchLibraryStatusChanged(status: string) {
        dispatchGlobalLibraryStatusChanged(numericSeriesId, status);
    }
    async function doToggleEpisode(seasonNumber: number, episodeNumber: number, nextWatched: boolean, runtimeMinutes: number | null) {
        const key = episodeKey(seasonNumber, episodeNumber);
        setWatchedKeys((prev) => {
            const next = new Set(prev);
            if (nextWatched)
                next.add(key);
            else
                next.delete(key);
            return next;
        });
        setSavingKey(key);
        startTransition(async () => {
            try {
                const body = await postEpisodeProgress({
                    seriesTmdbId: numericSeriesId,
                    seasonNumber,
                    episodeNumber,
                    watched: nextWatched,
                    runtimeMinutes,
                });
                if (body.ok && body.progress?.watchedKeys) {
                    setWatchedKeys(new Set(body.progress.watchedKeys));
                }
                if (nextWatched)
                    dispatchLibraryStatusChanged("watching");
            }
            catch (err) {
                setWatchedKeys((prev) => {
                    const next = new Set(prev);
                    if (nextWatched)
                        next.delete(key);
                    else
                        next.add(key);
                    return next;
                });
                console.warn("[episode toggle] erro:", err);
            }
            finally {
                setSavingKey(null);
            }
        });
    }
    async function doBulkMarkEpisodes(episodes: Array<{
        seasonNumber: number;
        episodeNumber: number;
        runtimeMinutes: number | null;
    }>) {
        const keys = episodes.map((ep) => episodeKey(ep.seasonNumber, ep.episodeNumber));
        setWatchedKeys((prev) => {
            const next = new Set(prev);
            keys.forEach((k) => next.add(k));
            return next;
        });
        // Marca o primeiro como saving para feedback visual
        if (keys.length > 0)
            setSavingKey(keys[keys.length - 1]);
        startTransition(async () => {
            try {
                const body = await postEpisodeProgress({
                    seriesTmdbId: numericSeriesId,
                    bulk: episodes,
                });
                if (body.ok && body.progress?.watchedKeys) {
                    setWatchedKeys(new Set(body.progress.watchedKeys));
                }
                dispatchLibraryStatusChanged("watching");
            }
            catch (err) {
                setWatchedKeys((prev) => {
                    const next = new Set(prev);
                    keys.forEach((k) => next.delete(k));
                    return next;
                });
                console.warn("[bulk episode toggle] erro:", err);
            }
            finally {
                setSavingKey(null);
            }
        });
    }
    function toggleEpisode(seasonNumber: number, episodeNumber: number, nextWatched: boolean, runtimeMinutes: number | null) {
        // Ao desmarcar: vai direto, sem diálogo
        if (!nextWatched || !season) {
            void doToggleEpisode(seasonNumber, episodeNumber, nextWatched, runtimeMinutes);
            return;
        }
        // Ao marcar: verifica se há episódios anteriores não assistidos nessa temporada
        const now = Date.now();
        const prevUnwatched = season.episodes
            .filter((ep) => ep.episodeNumber < episodeNumber &&
            ep.airDate &&
            new Date(ep.airDate).getTime() <= now &&
            !watchedKeys.has(episodeKey(seasonNumber, ep.episodeNumber)))
            .map((ep) => ({ episodeNumber: ep.episodeNumber, runtimeMinutes: ep.runtime ?? null }));
        if (prevUnwatched.length === 0) {
            void doToggleEpisode(seasonNumber, episodeNumber, nextWatched, runtimeMinutes);
            return;
        }
        // Há anteriores não assistidos: abre diálogo de confirmação
        setPendingPrevDialog({
            seasonNumber,
            episodeNumber,
            runtimeMinutes,
            prevEpisodes: prevUnwatched,
        });
    }
    async function handleMarkSeason(seasonNumber: number) {
        if (!season || seasonSaving)
            return;
        const now = Date.now();
        const episodesToMark = season.episodes.filter((ep) => ep.airDate && new Date(ep.airDate).getTime() <= now);
        const keysToAdd = episodesToMark.map((ep) => episodeKey(seasonNumber, ep.episodeNumber));
        setWatchedKeys((prev) => {
            const next = new Set(prev);
            keysToAdd.forEach((k) => next.add(k));
            return next;
        });
        setSeasonSaving(true);
        try {
            const body = await postEpisodeProgress({
                seriesTmdbId: numericSeriesId,
                bulk: episodesToMark.map((ep) => ({
                    seasonNumber,
                    episodeNumber: ep.episodeNumber,
                    runtimeMinutes: ep.runtime ?? null,
                })),
            });
            if (body.ok && body.progress?.watchedKeys) {
                setWatchedKeys(new Set(body.progress.watchedKeys));
            }
            dispatchLibraryStatusChanged("watching");
        }
        catch (err) {
            setWatchedKeys((prev) => {
                const next = new Set(prev);
                keysToAdd.forEach((k) => next.delete(k));
                return next;
            });
            console.warn("[season mark] erro:", err);
        }
        finally {
            setSeasonSaving(false);
        }
    }
    async function handleMarkAllAired() {
        if (seasonSaving)
            return;
        setSeasonSaving(true);
        try {
            // Carrega todas as temporadas não cacheadas para garantir que os episódios
            // estejam disponíveis no cliente e sejam persistidos no DB via write-through.
            await Promise.all(seasons.map(async (s) => {
                if (seasonCacheRef.current.has(s.seasonNumber))
                    return;
                try {
                    const res = await fetch(`/api/poplog3/tv/${seriesTmdbId}/seasons/${s.seasonNumber}`);
                    if (!res.ok)
                        return;
                    const data = (await res.json()) as SeasonDto;
                    seasonCacheRef.current.set(s.seasonNumber, data);
                }
                catch {
                    // Temporada não carregável — ignora sem bloquear o fluxo
                }
            }));
            const now = Date.now();
            const episodesToMark: Array<{
                seasonNumber: number;
                episodeNumber: number;
                runtimeMinutes: number | null;
            }> = [];
            for (const s of seasons) {
                const cachedSeason = seasonCacheRef.current.get(s.seasonNumber);
                if (!cachedSeason)
                    continue;
                for (const ep of cachedSeason.episodes) {
                    if (ep.episodeNumber > 0 &&
                        ep.airDate &&
                        new Date(ep.airDate).getTime() <= now) {
                        episodesToMark.push({
                            seasonNumber: cachedSeason.seasonNumber,
                            episodeNumber: ep.episodeNumber,
                            runtimeMinutes: ep.runtime ?? null,
                        });
                    }
                }
            }
            const body = episodesToMark.length > 0
                ? await postEpisodeProgress({
                    seriesTmdbId: numericSeriesId,
                    bulk: episodesToMark,
                })
                : // Fallback: DB pode já ter os episódios (série com cache TMDB)
                    await postEpisodeProgress({
                        seriesTmdbId: numericSeriesId,
                        markAllAired: true,
                    });
            if (body.ok && body.progress?.watchedKeys) {
                setWatchedKeys(new Set(body.progress.watchedKeys));
            }
            dispatchLibraryStatusChanged("watching");
            dispatchSeriesProgressRefresh(numericSeriesId);
        }
        catch (err) {
            console.warn("[series mark all aired] erro:", err);
        }
        finally {
            setSeasonSaving(false);
        }
    }
    async function handleClearSeason(seasonNumber: number) {
        if (!season || seasonSaving)
            return;
        const keysToRemove = season.episodes.map((ep) => episodeKey(seasonNumber, ep.episodeNumber));
        setWatchedKeys((prev) => {
            const next = new Set(prev);
            keysToRemove.forEach((k) => next.delete(k));
            return next;
        });
        setSeasonSaving(true);
        try {
            const body = await postEpisodeProgress({
                seriesTmdbId: numericSeriesId,
                clearSeason: seasonNumber,
            });
            if (body.ok && body.progress?.watchedKeys) {
                setWatchedKeys(new Set(body.progress.watchedKeys));
            }
        }
        catch (err) {
            setWatchedKeys((prev) => {
                const next = new Set(prev);
                keysToRemove.forEach((k) => next.add(k));
                return next;
            });
            console.warn("[season clear] erro:", err);
        }
        finally {
            setSeasonSaving(false);
        }
    }
    return (<section className="flex flex-col gap-5">
      <SectionHeader eyebrow={uiMessage("ui.9c37bc8a2216", { v1: seasons.length, v2: seasons.length === 1 ? "temporada" : "temporadas" })} title={uiMessage("ui.3d80292f41d1")} subtitle={subtitle} accent="indigo"/>

      <div className="flex flex-wrap gap-2">
        {seasons.map((s) => {
            const active = s.seasonNumber === selected;
            const futureNoEps = (!s.episodeCount || s.episodeCount === 0) &&
                s.airDate &&
                new Date(s.airDate).getTime() > Date.now();
            return (<button key={s.seasonNumber} type="button" onClick={() => setSelected(s.seasonNumber)} title={futureNoEps ? `Estreia ${formatAirDate(s.airDate)}` : undefined} className={[
                    "rounded-full border px-3.5 py-1.5 text-[12px] font-semibold tracking-[-0.01em] transition duration-200 backdrop-blur-md",
                    active
                        ? "border-indigo-300/45 bg-indigo-500/22 text-indigo-50 shadow-[0_0_24px_rgba(129,140,248,0.22)]"
                        : "border-white/[0.08] bg-white/[0.04] text-white/72 hover:border-white/[0.18] hover:bg-white/[0.08] hover:text-white",
                ].join(" ")}>
              T{String(s.seasonNumber).padStart(2, "0")}
              {futureNoEps && (<span className="ml-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-200/80">
                  ●
                </span>)}
            </button>);
        })}
      </div>

      {isAuthenticated && (<div className="flex justify-end">
          <button type="button" disabled={seasonSaving} onClick={handleMarkAllAired} className="rounded-xl border border-emerald-300/28 bg-emerald-500/10 px-3.5 py-1.5 text-[12px] font-semibold tracking-[-0.01em] text-emerald-200/90 transition duration-200 hover:border-emerald-300/48 hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-50">
            {seasonSaving ? t("title.progress.saving") : t("title.progress.markReleased")}
          </button>
        </div>)}

      {season && season.episodes.length > 0 && (() => {
            const now = Date.now();
            const airedEps = season.episodes.filter((ep) => ep.airDate && new Date(ep.airDate).getTime() <= now);
            if (airedEps.length === 0)
                return null;
            const watchedCount = airedEps.filter((ep) => watchedKeys.has(episodeKey(selected, ep.episodeNumber))).length;
            const allWatched = watchedCount === airedEps.length;
            return (<div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-white/70">{uiMessage("ui.b11349f63682")}{String(selected).padStart(2, "0")}
              </p>
              <p className="mt-0.5 text-[12px] text-white/50">
                {watchedCount > 0 ? (<>
                    <span className="font-semibold text-emerald-300/90">
                      {watchedCount}
                    </span>
                    {" de "}
                    <span className="font-semibold text-white/72">
                      {airedEps.length}
                    </span>
                    {airedEps.length === 1 ? uiMessage("ui.3942fa6d8b81") : uiMessage("ui.b730a645d35b")}
                  </>) : (<>
                    {airedEps.length}{" "}
                    {airedEps.length === 1
                        ? uiMessage("ui.227a06a3c6a2") : uiMessage("ui.1d64930bf7be")}
                  </>)}
              </p>
            </div>

            <button type="button" disabled={seasonSaving} onClick={() => allWatched
                    ? handleClearSeason(selected)
                    : handleMarkSeason(selected)} className={[
                    "shrink-0 rounded-xl border px-3.5 py-1.5 text-[12px] font-semibold tracking-[-0.01em] transition duration-200 disabled:cursor-not-allowed disabled:opacity-50",
                    allWatched
                        ? "border-rose-300/28 bg-rose-500/10 text-rose-200/90 hover:border-rose-300/48 hover:bg-rose-500/20"
                        : "border-emerald-300/28 bg-emerald-500/10 text-emerald-200/90 hover:border-emerald-300/48 hover:bg-emerald-500/20",
                ].join(" ")}>
              {seasonSaving
                    ? "Salvando…"
                    : allWatched
                        ? t("title.progress.unmarkSeason")
                        : t("title.progress.markSeason", { season: selected })}
            </button>
          </div>);
        })()}

      {loading && !season && (<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (<div key={i} className="h-[170px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025]"/>))}
        </div>)}

      {error && (<p className="rounded-2xl border border-rose-300/22 bg-rose-500/12 p-4 text-[13px] text-rose-100/90">{uiMessage("ui.808684900947")}{error}
        </p>)}

      {season && season.episodes.length > 0 && (<>
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {visibleEpisodes.map((ep) => {
                const key = episodeKey(selected, ep.episodeNumber);
                const watched = watchedKeys.has(key);
                const saving = savingKey === key;
                const cachedComments = commentsCache[key];
                return (<EpisodeCard key={ep.episodeNumber} episode={ep} seasonNumber={selected} watched={watched} saving={saving} communityCount={cachedComments?.total ?? null} onToggle={(next) => toggleEpisode(selected, ep.episodeNumber, next, ep.runtime ?? null)} onOpen={() => setActiveEpisode({
                        seasonNumber: selected,
                        episode: ep,
                    })}/>);
            })}
          </div>

          {hasMoreEpisodes && (<div className="flex justify-center pt-2">
              <button type="button" onClick={() => setVisibleCount((prev) => prev + EPISODES_PER_PAGE)} className="rounded-2xl border border-white/[0.10] bg-white/[0.04] px-5 py-3 text-[13px] font-semibold text-white/82 transition hover:border-white/[0.20] hover:bg-white/[0.08]">{uiMessage("ui.3a1488d4b774")}</button>
            </div>)}
        </>)}

      {season && season.episodes.length === 0 && (<UpcomingSeasonNotice seasonMeta={selectedMeta}/>)}

      {activeEpisode && (<EpisodeModal key={episodeKey(activeEpisode.seasonNumber, activeEpisode.episode.episodeNumber)} seriesName={seriesName} seriesTmdbId={seriesTmdbId} episode={activeEpisode.episode} seasonNumber={activeEpisode.seasonNumber} isAuthenticated={isAuthenticated} watched={watchedKeys.has(episodeKey(activeEpisode.seasonNumber, activeEpisode.episode.episodeNumber))} saving={savingKey ===
                episodeKey(activeEpisode.seasonNumber, activeEpisode.episode.episodeNumber)} cachedComments={commentsCache[episodeKey(activeEpisode.seasonNumber, activeEpisode.episode.episodeNumber)]} onCacheComments={handleCacheComments} onSeriesCommunityRatingChange={onSeriesCommunityRatingChange} onClose={() => setActiveEpisode(null)} onToggle={(next) => toggleEpisode(activeEpisode.seasonNumber, activeEpisode.episode.episodeNumber, next, activeEpisode.episode.runtime ?? null)}/>)}

      {pendingPrevDialog && (<PreviousEpisodesDialog count={pendingPrevDialog.prevEpisodes.length} onMarkAll={() => {
                const { seasonNumber, episodeNumber, runtimeMinutes, prevEpisodes } = pendingPrevDialog;
                setPendingPrevDialog(null);
                void doBulkMarkEpisodes([
                    ...prevEpisodes.map((ep) => ({ seasonNumber, ...ep })),
                    { seasonNumber, episodeNumber, runtimeMinutes },
                ]);
            }} onMarkOnly={() => {
                const { seasonNumber, episodeNumber, runtimeMinutes } = pendingPrevDialog;
                setPendingPrevDialog(null);
                void doToggleEpisode(seasonNumber, episodeNumber, true, runtimeMinutes);
            }} onCancel={() => setPendingPrevDialog(null)}/>)}
    </section>);
}
type PreviousEpisodesDialogProps = {
    count: number;
    onMarkAll: () => void;
    onMarkOnly: () => void;
    onCancel: () => void;
};
function PreviousEpisodesDialog({ count, onMarkAll, onMarkOnly, onCancel, }: PreviousEpisodesDialogProps) {
    return (<div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/72 px-4 py-4 sm:items-center" role="dialog" aria-modal="true" aria-label={uiMessage("ui.437e23102e92")} onMouseDown={onCancel}>
      <div className="w-full max-w-sm overflow-hidden rounded-[1.5rem] border border-white/[0.12] bg-zinc-950 shadow-[0_24px_80px_rgba(0,0,0,0.65)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-5 pb-2 pt-5">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-300/70">
              Continuidade
            </span>
          </div>
          <h2 className="text-[17px] font-bold tracking-[-0.03em] text-white">{uiMessage("ui.2fb1bc805ca9")}</h2>
          <p className="mt-1.5 text-[13px] leading-[1.55] text-white/52">
            {count === 1
            ? uiMessage("ui.cd84493a004d") : uiMessage("ui.d9e9aac89ac0", { v1: count })}{" "}{uiMessage("ui.ff82a6038441")}</p>
        </div>

        <div className="flex flex-col gap-2 p-4">
          <button type="button" onClick={onMarkAll} className="w-full rounded-xl border border-indigo-300/28 bg-indigo-500/14 px-4 py-3 text-[13px] font-bold tracking-[-0.01em] text-indigo-50 transition hover:border-indigo-300/45 hover:bg-indigo-500/22">{uiMessage("ui.78210d70c9a3")}</button>

          <button type="button" onClick={onMarkOnly} className="w-full rounded-xl border border-white/[0.09] bg-white/[0.04] px-4 py-3 text-[13px] font-bold tracking-[-0.01em] text-white/78 transition hover:border-white/[0.18] hover:bg-white/[0.08]">{uiMessage("ui.728cf6eaa47b")}</button>

          <button type="button" onClick={onCancel} className="w-full rounded-xl px-4 py-2.5 text-[12px] font-semibold text-white/35 transition hover:text-white/60">
            Cancelar
          </button>
        </div>
      </div>
    </div>);
}
function UpcomingSeasonNotice({ seasonMeta, }: {
    seasonMeta: TitleSeasonInfo | null;
}) {
    const airDate = formatAirDate(seasonMeta?.airDate ?? null);
    return (<div className="relative overflow-hidden rounded-2xl border border-amber-300/18 bg-amber-500/[0.06] p-5 sm:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(251,191,36,0.16),transparent_50%)]" aria-hidden/>

      <div className="relative flex flex-col gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-200/80">{uiMessage("ui.0f6dfca7d303")}</p>

        <h3 className="text-[15px] font-bold tracking-[-0.02em] text-white sm:text-base">{uiMessage("ui.c4e7aed998c0")}</h3>

        <p className="text-[13px] leading-6 text-white/55">
          {airDate
            ? uiMessage("ui.48b42bf2d377", { v1: airDate }) : uiMessage("ui.b956c68a1f32")}
        </p>
      </div>
    </div>);
}
type EpisodeCardProps = {
    episode: EpisodeDto;
    seasonNumber: number;
    watched: boolean;
    saving: boolean;
    communityCount?: number | null;
    onToggle: (next: boolean) => void;
    onOpen: () => void;
};
function EpisodeCard({ episode, seasonNumber, watched, saving, communityCount, onToggle, onOpen, }: EpisodeCardProps) {
    const stillSrc = resolveForRender(episode.stillUrl);
    const airDate = formatAirDate(episode.airDate);
    const runtime = formatRuntimeLabel(episode.runtime, { spaced: true });
    const isFinale = episode.episodeType === "finale" ||
        episode.episodeType === "season_finale" ||
        episode.episodeType === "series_finale" ||
        episode.episodeType === "mid_season_finale";
    const isPremiere = episode.episodeType === "season_premiere" ||
        episode.episodeType === "premiere" ||
        episode.episodeType === "series_premiere";
    const airTime = episode.airDate ? new Date(episode.airDate).getTime() : NaN;
    const aired = Number.isFinite(airTime) && airTime <= Date.now();
    const communityLabel = !aired
        ? null
        : typeof communityCount === "number" && communityCount > 0
            ? `${communityCount} ${communityCount === 1 ? uiMessage("ui.8001800f20fc") : uiMessage("ui.7f6320ba178c")}`
            : "Comunidade reagindo";
    return (<article role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen();
            }
        }} className={[
            "group flex cursor-pointer flex-col overflow-hidden rounded-[1.25rem] border backdrop-blur-md transition duration-300 focus:outline-none focus:ring-2 focus:ring-indigo-300/35 sm:flex-row",
            watched
                ? "border-emerald-300/22 bg-emerald-500/[0.06] hover:border-emerald-300/35 hover:bg-emerald-500/[0.10]"
                : "border-white/[0.08] bg-white/[0.025] hover:border-white/[0.18] hover:bg-white/[0.055]",
        ].join(" ")}>
      <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-zinc-900 sm:aspect-auto sm:w-[200px]">
        {stillSrc ? (<Image src={stillSrc} alt={episode.name ?? uiMessage("ui.7a13022bd85a", { v1: episode.episodeNumber })} fill unoptimized sizes="(max-width: 640px) 100vw, 200px" className={[
                "object-cover transition duration-500 group-hover:scale-[1.04]",
                watched
                    ? "brightness-[0.6] saturate-[0.9]"
                    : "brightness-[0.86] saturate-[1.06] group-hover:brightness-100",
            ].join(" ")}/>) : (<div className="grid h-full w-full place-items-center bg-gradient-to-br from-zinc-900 to-zinc-950 text-[10px] uppercase tracking-[0.2em] text-white/30">{uiMessage("ui.01c119dc9e1b")}</div>)}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/72 via-black/12 to-transparent" aria-hidden/>

        <div className="absolute left-2.5 top-2.5 rounded-md border border-white/[0.12] bg-black/65 px-2 py-0.5 text-[10px] font-black tracking-[0.06em] text-white/85 backdrop-blur-md">
          S{String(seasonNumber).padStart(2, "0")}E
          {String(episode.episodeNumber).padStart(2, "0")}
        </div>

        {(isFinale || isPremiere) && (<div className={`absolute right-2.5 top-2.5 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] backdrop-blur-md ${isFinale
                ? "border-rose-300/30 bg-rose-500/22 text-rose-100"
                : "border-cyan-300/30 bg-cyan-500/22 text-cyan-100"}`}>
            {isFinale ? "Final" : "Estreia"}
          </div>)}

        {watched && (<div className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-500/22 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-100 backdrop-blur-md">
            <span aria-hidden>✓</span> Visto
          </div>)}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-[14px] font-bold tracking-[-0.015em] text-white sm:text-[15px]">
            {episode.name ?? uiMessage("ui.7a13022bd85a", { v1: episode.episodeNumber })}
          </h3>

          {typeof episode.voteAverage === "number" &&
            episode.voteAverage > 0 && (<span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300/22 bg-amber-400/10 px-2 py-0.5 text-[10px] font-black text-amber-100">
                <span aria-hidden>★</span>
                {episode.voteAverage.toFixed(1)}
              </span>)}
        </div>

        <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
          {airDate && <span>{airDate}</span>}

          {airDate && runtime && (<span aria-hidden className="text-white/20">
              ·
            </span>)}

          {runtime && <span>{runtime}</span>}
        </div>

        {episode.overview && (<p className="line-clamp-3 text-[12.5px] leading-[1.55] text-white/65">
            {episode.overview}
          </p>)}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          {communityLabel ? (<span className="rounded-full border border-fuchsia-300/16 bg-fuchsia-500/[0.08] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-fuchsia-100/72">
              {communityLabel}
            </span>) : (<span />)}

          <button type="button" onClick={(event) => {
            event.stopPropagation();
            onToggle(!watched);
        }} disabled={!aired || saving} aria-pressed={watched} className={[
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition duration-200",
            !aired
                ? "cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-white/30"
                : watched
                    ? "border-emerald-300/30 bg-emerald-500/15 text-emerald-100 hover:border-emerald-300/45 hover:bg-emerald-500/25"
                    : "border-white/[0.10] bg-white/[0.04] text-white/72 hover:border-white/[0.20] hover:bg-white/[0.08] hover:text-white",
            saving ? "cursor-wait opacity-70" : "",
        ].join(" ")}>
            {saving ? (<span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" aria-hidden/>) : watched ? (<>
                <span aria-hidden>✓</span>{uiMessage("ui.ab53b20a28e7")}</>) : !aired ? (uiMessage("ui.e0195239e5c9")) : ("Marcar como visto")}
          </button>
        </div>
      </div>
    </article>);
}
type EpisodeModalProps = {
    seriesTmdbId: number | string;
    seriesName?: string | null;
    episode: EpisodeDto;
    seasonNumber: number;
    isAuthenticated?: boolean;
    watched: boolean;
    saving: boolean;
    cachedComments?: CachedEpisodeComments;
    onCacheComments: (cacheKey: string, payload: CachedEpisodeComments) => void;
    onSeriesCommunityRatingChange?: (rating: CommunityRatingData | null) => void;
    onClose: () => void;
    onToggle: (next: boolean) => void;
};
function EpisodeModal({ seriesTmdbId, seriesName, episode, seasonNumber, isAuthenticated = false, watched, saving, cachedComments, onCacheComments, onSeriesCommunityRatingChange, onClose, onToggle, }: EpisodeModalProps) {
    const airDate = formatAirDate(episode.airDate);
    const runtime = formatRuntimeLabel(episode.runtime, { spaced: true });
    const aired = !episode.airDate || new Date(episode.airDate).getTime() <= Date.now();
    const commentCacheKey = episodeKey(seasonNumber, episode.episodeNumber);
    // ── Avaliação pessoal do episódio ─────────────────────────────────────────
    const numericId = typeof seriesTmdbId === "number" ? seriesTmdbId : 0;
    const episodeRating = useUserRating({
        mediaType: "episode",
        tmdbId: numericId,
        seasonNumber,
        episodeNumber: episode.episodeNumber,
        isAuthenticated,
        onParentCommunityRatingChange: onSeriesCommunityRatingChange,
    });
    const isFinale = episode.episodeType === "finale" ||
        episode.episodeType === "season_finale" ||
        episode.episodeType === "series_finale" ||
        episode.episodeType === "mid_season_finale";
    const isPremiere = episode.episodeType === "season_premiere" ||
        episode.episodeType === "premiere" ||
        episode.episodeType === "series_premiere";
    const modalStillUrl = useMemo(() => resolveForRender(getOriginalTmdbImageUrl(episode.stillUrl)), [episode.stillUrl]);
    const [comments, setComments] = useState<EpisodeCommentDto[]>([]);
    const [commentsTotal, setCommentsTotal] = useState<number | null>(null);
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [commentsError, setCommentsError] = useState<string | null>(null);
    const [originalCommentIds, setOriginalCommentIds] = useState<Set<string>>(() => new Set());
    const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(() => new Set());
    const [commentsRefreshToken, setCommentsRefreshToken] = useState(0);
    const socialTab = "trakt";
    useEffect(() => {
        let cancelled = false;
        setComments([]);
        setCommentsTotal(null);
        setCommentsError(null);
        setOriginalCommentIds(new Set());
        setRevealedSpoilers(new Set());
        if (!aired) {
            setCommentsLoading(false);
            setCommentsTotal(0);
            return () => {
                cancelled = true;
            };
        }
        if (cachedComments && commentsRefreshToken === 0) {
            setComments(cachedComments.comments);
            setCommentsTotal(cachedComments.total);
            setCommentsLoading(false);
            return () => {
                cancelled = true;
            };
        }
        setCommentsLoading(true);
        const params = new URLSearchParams({
            tmdbId: String(seriesTmdbId),
            season: String(seasonNumber),
            episode: String(episode.episodeNumber),
        });
        const commentsUrl = `/api/dev/trakt-episode-comments-translated?${params.toString()}`;
        fetch(commentsUrl, { cache: "no-store" })
            .then(async (res) => {
            const body = (await res.json().catch(() => null)) as EpisodeCommentsResponse | null;
            if (cancelled)
                return null;
            if (!res.ok) {
                throw new Error(body?.error || `HTTP ${res.status}`);
            }
            if (body?.error) {
                throw new Error(body.error);
            }
            return body;
        })
            .then((body) => {
            if (cancelled || !body)
                return;
            const nextComments = Array.isArray(body.comments) ? body.comments : [];
            const nextTotal = typeof body.total === "number" ? body.total : nextComments.length;
            setComments(nextComments);
            setCommentsTotal(nextTotal);
            onCacheComments(commentCacheKey, {
                total: nextTotal,
                comments: nextComments,
            });
        })
            .catch((err) => {
            if (cancelled)
                return;
            const message = err instanceof Error ? err.message : uiMessage("ui.833b7d9fdcc9");
            console.warn("[trakt episode comments] erro:", {
                url: commentsUrl,
                seriesTmdbId,
                seasonNumber,
                episodeNumber: episode.episodeNumber,
                message,
            });
            setCommentsError(message);
            setComments([]);
            setCommentsTotal(0);
        })
            .finally(() => {
            if (cancelled)
                return;
            setCommentsLoading(false);
            if (commentsRefreshToken > 0) {
                setCommentsRefreshToken(0);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [
        aired,
        cachedComments,
        commentCacheKey,
        commentsRefreshToken,
        episode.episodeNumber,
        onCacheComments,
        seasonNumber,
        seriesTmdbId,
    ]);
    const socialTabs = [
        {
            id: "trakt" as const,
            label: "Trakt",
            count: commentsTotal || comments.length || 0,
            loading: commentsLoading,
        },
    ];
    return (<div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/82 px-3 py-3 sm:items-center sm:px-5 sm:py-6" role="dialog" aria-modal="true" aria-label={uiMessage("ui.396be89197d3", { v1: episodeKey(seasonNumber, episode.episodeNumber) })} onMouseDown={onClose}>
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.7rem] border border-white/[0.10] bg-zinc-950 shadow-[0_28px_120px_rgba(0,0,0,0.75)]" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full border border-white/[0.12] bg-black/70 text-lg leading-none text-white/80 transition hover:border-white/[0.25] hover:bg-white/[0.10] hover:text-white" aria-label={uiMessage("ui.354ab5391b5e")}>
          ×
        </button>

        <div className="max-h-[92vh] overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-white/[0.03] scrollbar-thumb-white/[0.16]">
          <div className="relative min-h-[260px] overflow-hidden sm:min-h-[360px]">
            {modalStillUrl ? (<Image src={modalStillUrl} alt={episode.name ?? uiMessage("ui.7a13022bd85a", { v1: episode.episodeNumber })} fill unoptimized sizes="(max-width: 768px) 100vw, 1024px" className="object-cover brightness-[0.78] saturate-[1.08]"/>) : (<div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(99,102,241,0.28),transparent_42%),linear-gradient(135deg,#111827,#020617_65%,#000)]"/>)}

            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/42 to-black/20" aria-hidden/>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_100%,rgba(99,102,241,0.22),transparent_44%)]" aria-hidden/>

            <div className="absolute bottom-0 left-0 right-0 flex flex-col gap-3 p-5 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-white/[0.14] bg-black/45 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/82 backdrop-blur-md">
                  {episodeKey(seasonNumber, episode.episodeNumber)}
                </span>

                <button type="button" onClick={() => onToggle(!watched)} disabled={!aired || saving} className={[
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] backdrop-blur-md transition duration-200",
            !aired
                ? "cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-white/30"
                : watched
                    ? "border-emerald-300/40 bg-emerald-500/22 text-emerald-100 hover:border-emerald-300/60 hover:bg-emerald-500/35"
                    : "border-white/[0.14] bg-black/45 text-white/60 hover:border-indigo-300/40 hover:bg-indigo-500/20 hover:text-indigo-100",
            saving ? "cursor-wait opacity-70" : "",
        ].join(" ")}>
                  {saving ? (<span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent"/>) : watched ? (<>{uiMessage("ui.f75cb112cc9b")}</>) : !aired ? (uiMessage("ui.e0195239e5c9")) : ("Marcar como visto")}
                </button>

                {(isFinale || isPremiere) && (<span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] backdrop-blur-md ${isFinale
                ? "border-rose-300/30 bg-rose-500/20 text-rose-100"
                : "border-cyan-300/30 bg-cyan-500/20 text-cyan-100"}`}>
                    {isFinale ? "Final de temporada" : "Estreia"}
                  </span>)}
              </div>

              <div className="max-w-3xl">
                {seriesName && (<p className="mb-2 text-[11px] font-black uppercase tracking-[0.22em] text-indigo-200/75">
                    {seriesName}
                  </p>)}
                <h2 className="text-2xl font-black tracking-[-0.045em] text-white sm:text-4xl">
                  {episode.name ?? uiMessage("ui.7a13022bd85a", { v1: episode.episodeNumber })}
                </h2>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">
                  {airDate && <span>{airDate}</span>}

                  {airDate && runtime && (<span aria-hidden className="text-white/25">
                      ·
                    </span>)}

                  {runtime && <span>{runtime}</span>}

                  {typeof episode.voteAverage === "number" &&
            episode.voteAverage > 0 && (<>
                        {(airDate || runtime) && (<span aria-hidden className="text-white/25">
                            ·
                          </span>)}

                        <span className="text-amber-100">
                          ★ {episode.voteAverage.toFixed(1)}
                        </span>
                      </>)}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-5 p-5 sm:p-7">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 sm:p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200/80">{uiMessage("ui.b1f4804e0ef9")}</p>

              {isAuthenticated ? (<div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <StarRating value={episodeRating.rating} size="lg" interactive onChange={episodeRating.selectRating} ariaLabel={uiMessage("ui.b1f4804e0ef9")}/>

                  <div className="flex items-center gap-2.5">
                    {episodeRating.rating !== null ? (<>
                        <span className="text-[22px] font-black tabular-nums leading-none text-amber-300">
                          {episodeRating.rating.toFixed(1)}
                        </span>
                        <button type="button" onClick={episodeRating.clearRating} disabled={episodeRating.isPending} className="rounded-full border border-white/[0.09] bg-white/[0.04] px-2.5 py-1 text-[9.5px] font-black uppercase tracking-[0.16em] text-white/38 transition hover:border-rose-300/28 hover:bg-rose-500/10 hover:text-rose-200/80 disabled:opacity-40">
                          Remover
                        </button>
                      </>) : (<span className="text-[12px] text-white/32">
                        {episodeRating.isPending ? "Salvando…" : "Sem nota"}
                      </span>)}

                    {episodeRating.isPending && episodeRating.rating !== null && (<span className="h-3 w-3 animate-spin rounded-full border border-amber-300/60 border-t-transparent"/>)}
                  </div>
                </div>) : (<div className="mt-3 flex items-center gap-3">
                  <StarRating value={null} size="lg" interactive={false} ariaLabel={uiMessage("ui.31eaca45f1f8")}/>
                  <span className="text-[12px] text-white/35">{uiMessage("ui.1312499b3477")}</span>
                </div>)}

              {episodeRating.error && (<p className="mt-2 text-[11px] text-rose-300/80">
                  {episodeRating.error}
                </p>)}
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 sm:p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200/80">{uiMessage("ui.6d8d80b0960e")}</p>

              <p className="mt-3 text-[13.5px] leading-7 text-white/68 sm:text-[14px]">
                {episode.overview || uiMessage("ui.a771a4d4507f")}
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fuchsia-500/10">
                    {commentsLoading ? (<span className="h-2 w-2 animate-pulse rounded-full bg-fuchsia-400/70"/>) : comments.length > 0 ? (<>
                        <span className="absolute inset-0 animate-ping rounded-full bg-fuchsia-500/20"/>
                        <span className="h-2 w-2 rounded-full bg-fuchsia-400"/>
                      </>) : (<span className="h-2 w-2 rounded-full bg-white/20"/>)}
                  </div>

                  <div>
                    <p className="text-[9.5px] font-black uppercase tracking-[0.24em] text-fuchsia-300/55">{uiMessage("ui.4d7fb18c89a7")}</p>
                    <h3 className="mt-0.5 text-[15px] font-bold tracking-[-0.025em] text-white/90">
                      {!aired
            ? uiMessage("ui.bdf06a649c3a") : commentsLoading
            ? uiMessage("ui.01c600e77b74") : comments.length > 0
            ? `${commentsTotal || comments.length || 0} no Trakt`
            : uiMessage("ui.dba44fe37106")}
                    </h3>
                  </div>
                </div>

                {aired && (<button type="button" onClick={() => setCommentsRefreshToken((prev) => prev + 1)} disabled={commentsLoading} className="shrink-0 rounded-full border border-white/[0.09] bg-white/[0.03] px-3 py-1.5 text-[9.5px] font-black uppercase tracking-[0.18em] text-white/40 transition hover:border-white/[0.18] hover:bg-white/[0.07] hover:text-white/70 disabled:cursor-wait disabled:opacity-35">{uiMessage("ui.031b7febc33b")}</button>)}
              </div>

              {aired && (<p className="text-[11px] leading-5 text-white/25">{uiMessage("ui.d540e9d196e5")}</p>)}

              <div className="flex flex-wrap gap-2">
                {socialTabs.map((tab) => {
            const active = socialTab === tab.id;
            return (<button key={tab.id} type="button" onClick={() => undefined} className={[
                    "rounded-full border px-3.5 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] transition",
                    active
                        ? "border-fuchsia-300/35 bg-fuchsia-500/18 text-fuchsia-50"
                        : "border-white/[0.08] bg-white/[0.03] text-white/42 hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white/70",
                ].join(" ")}>
                      {tab.label}
                      {tab.loading ? (<span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-50"/>) : tab.count > 0 ? (<span className="ml-1.5 text-white/40">{tab.count}</span>) : null}
                    </button>);
        })}
              </div>

              {socialTab === "trakt" && (<>
                  {commentsLoading && (<div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                      {Array.from({ length: 4 }).map((_, index) => (<div key={index} className="flex gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.02] p-4">
                          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-white/[0.07]"/>
                          <div className="flex-1 space-y-2.5 pt-1">
                            <div className="h-2.5 w-28 animate-pulse rounded-full bg-white/[0.08]"/>
                            <div className="h-2.5 w-full animate-pulse rounded-full bg-white/[0.055]"/>
                            <div className="h-2.5 w-9/12 animate-pulse rounded-full bg-white/[0.04]"/>
                            <div className="h-2.5 w-5/12 animate-pulse rounded-full bg-white/[0.03]"/>
                          </div>
                        </div>))}
                    </div>)}

                  {!commentsLoading && commentsError && (<div className="flex items-start gap-3 rounded-2xl border border-rose-300/14 bg-rose-500/[0.07] p-4">
                      <span className="mt-0.5 text-base leading-none text-rose-400/60">
                        ⚠
                      </span>
                      <p className="text-[12.5px] leading-6 text-rose-100/68">{uiMessage("ui.eb0d384d24a7")}{commentsError}
                      </p>
                    </div>)}

                  {!commentsLoading && !commentsError && comments.length === 0 && (<p className="text-[12.5px] leading-6 text-white/35">
                      {!aired
                    ? uiMessage("ui.512af74b6f5e") : uiMessage("ui.227d13da0294")}
                    </p>)}

                  {!commentsLoading && comments.length > 0 && (<div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                      {comments.slice(0, 6).map((comment) => {
                    const id = String(comment.id);
                    const isSpoiler = Boolean(comment.spoiler);
                    const spoilerRevealed = revealedSpoilers.has(id);
                    const showingOriginal = originalCommentIds.has(id);
                    const originalText = comment.originalComment?.trim();
                    const translatedText = comment.displayComment?.trim() ||
                        comment.translatedComment?.trim() ||
                        originalText;
                    const text = showingOriginal
                        ? originalText || translatedText
                        : translatedText || originalText;
                    const username = comment.user?.username ?? "trakt";
                    const initial = username[0].toUpperCase();
                    const hue = username
                        .split("")
                        .reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
                    return (<div key={id} className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]">
                            <div className="absolute bottom-3 left-0 top-3 w-[2px] rounded-full" style={{
                            background: `hsl(${hue}, 55%, 62%)`,
                            opacity: 0.35,
                        }} aria-hidden/>

                            <div className="flex gap-3 pl-2.5">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white/85" style={{
                            background: `hsl(${hue}, 38%, 20%)`,
                            outline: `1.5px solid hsl(${hue}deg 38% 38% / 0.35)`,
                        }}>
                                {initial}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[12px] font-bold text-white/78">
                                    @{username}
                                  </span>

                                  {isSpoiler && (<span className="inline-flex items-center gap-1 rounded-full border border-amber-300/18 bg-amber-400/[0.08] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.13em] text-amber-200/75">
                                      <span aria-hidden>⚡</span> Spoiler
                                    </span>)}

                                  {!showingOriginal &&
                            comment.translationStatus &&
                            comment.translationStatus !== "translated" && (<span className="rounded-full border border-white/[0.06] bg-white/[0.025] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/28">
                                        original
                                      </span>)}

                                  {typeof comment.likes === "number" && comment.likes > 0 && (<span className="ml-auto flex items-center gap-1 text-[10.5px] font-medium text-white/28">
                                      <span aria-hidden className="text-[9px] text-white/35">
                                        ♥
                                      </span>
                                      {comment.likes}
                                    </span>)}
                                </div>

                                {isSpoiler && !spoilerRevealed ? (<div className="mt-2.5 rounded-xl border border-amber-300/10 bg-amber-400/[0.04] px-3.5 py-3">
                                    <p className="text-[12px] leading-5 text-white/40">{uiMessage("ui.8a2041cfdbee")}</p>
                                    <button type="button" onClick={() => setRevealedSpoilers((prev) => {
                                const next = new Set(prev);
                                next.add(id);
                                return next;
                            })} className="mt-2 rounded-full border border-amber-300/18 bg-amber-400/[0.08] px-3 py-1.5 text-[9.5px] font-black uppercase tracking-[0.16em] text-amber-200/85 transition hover:bg-amber-400/12">{uiMessage("ui.835ffc42ca4e")}</button>
                                  </div>) : (<div className="mt-2">
                                    <p className="whitespace-pre-line text-[13px] leading-[1.68] text-white/58">
                                      {text || uiMessage("ui.b5462477ec30")}
                                    </p>

                                    {originalText &&
                                translatedText &&
                                originalText !== translatedText && (<button type="button" onClick={() => setOriginalCommentIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(id)) {
                                        next.delete(id);
                                    }
                                    else {
                                        next.add(id);
                                    }
                                    return next;
                                })} className="mt-2.5 rounded-full border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 text-[9.5px] font-black uppercase tracking-[0.16em] text-white/36 transition hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white/62">
                                          {showingOriginal
                                    ? uiMessage("ui.3efd4fc123b7") : "Ver original →"}
                                        </button>)}
                                  </div>)}
                              </div>
                            </div>
                          </div>);
                })}
                    </div>)}
                </>)}

            </div>
          </div>
        </div>
      </div>
    </div>);
}


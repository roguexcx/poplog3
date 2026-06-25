"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { useState, useTransition } from "react";
import { dispatchSeriesProgressRefresh, markEpisodesUntil, toAnyTmdbId, } from "./episodeProgressClient";
import type { TitleSeriesProgress } from "./types";
type SeriesProgressChipProps = {
    tmdbId: number | string;
    progress: TitleSeriesProgress | null;
    hasSeasons: boolean;
};
function pad2(n: number) {
    return String(n).padStart(2, "0");
}
export default function SeriesProgressChip({ tmdbId, progress, hasSeasons, }: SeriesProgressChipProps) {
    const id = toAnyTmdbId(tmdbId);
    const [pending, setPending] = useState(false);
    const [done, setDone] = useState(false);
    const [, startTransition] = useTransition();
    if (id === 0)
        return null;
    const watchedCount = progress?.watchedCount ?? 0;
    const nextEp = progress?.nextEpisode ?? null;
    const airedEpisodes = progress?.airedEpisodes ?? progress?.totalEpisodes ?? null;
    const isUpToDate = typeof airedEpisodes === "number" &&
        airedEpisodes > 0 &&
        watchedCount >= airedEpisodes;
    if (isUpToDate) {
        return (<span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-500/[0.10] px-3 py-1.5 text-[11px] font-black text-emerald-100">
        <span aria-hidden className="text-[10px]">{"✓"}</span>{uiMessage("ui.c6f2bf7046b4")}</span>);
    }
    if (nextEp) {
        const label = `Marcar S${pad2(nextEp.seasonNumber)}E${pad2(nextEp.episodeNumber)}`;
        async function handleMark() {
            if (pending || done)
                return;
            setPending(true);
            startTransition(async () => {
                try {
                    await markEpisodesUntil({
                        seriesTmdbId: id,
                        seasonNumber: nextEp!.seasonNumber,
                        episodeNumber: nextEp!.episodeNumber,
                    });
                    setDone(true);
                    dispatchSeriesProgressRefresh(id);
                }
                catch {
                    // falha silenciosa
                }
                finally {
                    setPending(false);
                }
            });
        }
        if (done) {
            return (<span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/25 bg-cyan-500/[0.10] px-3 py-1.5 text-[11px] font-black text-cyan-100">
          <span aria-hidden className="text-[10px]">{"✓"}</span>{uiMessage("ui.0d521e89105b")}</span>);
        }
        return (<button type="button" disabled={pending} onClick={handleMark} className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-500/[0.12] px-3 py-1.5 text-[11px] font-black text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-500/[0.20] disabled:cursor-wait disabled:opacity-60" title={label}>
        {pending ? (<>
            <span aria-hidden className="text-[10px] opacity-60">{"○"}</span>
            Salvando...
          </>) : (<>
            <span aria-hidden className="text-[10px]">{"+"}</span>
            {label}
          </>)}
      </button>);
    }
    if (watchedCount === 0 && hasSeasons) {
        async function handleStart() {
            if (pending || done)
                return;
            setPending(true);
            startTransition(async () => {
                try {
                    await markEpisodesUntil({
                        seriesTmdbId: id,
                        seasonNumber: 1,
                        episodeNumber: 1,
                    });
                    setDone(true);
                    dispatchSeriesProgressRefresh(id);
                }
                catch {
                    // falha silenciosa
                }
                finally {
                    setPending(false);
                }
            });
        }
        if (done) {
            return (<span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/25 bg-cyan-500/[0.10] px-3 py-1.5 text-[11px] font-black text-cyan-100">
          <span aria-hidden className="text-[10px]">{"✓"}</span>{uiMessage("ui.c4938fe924b1")}</span>);
        }
        return (<button type="button" disabled={pending} onClick={handleStart} className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.14] bg-white/[0.06] px-3 py-1.5 text-[11px] font-black text-white/70 transition hover:border-white/[0.24] hover:bg-white/[0.10] hover:text-white disabled:cursor-wait disabled:opacity-60" title={uiMessage("ui.4add6fa61612")}>
        {pending ? (<>
            <span aria-hidden className="text-[10px] opacity-60">{"○"}</span>
            Salvando...
          </>) : (<>
            <span aria-hidden className="text-[10px]">{"+"}</span>
            {uiMessage("ui.d2ae2659f73e")}
          </>)}
      </button>);
    }
    return null;
}


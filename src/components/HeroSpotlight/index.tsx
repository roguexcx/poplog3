"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ScoredItem, SignalType } from "./types";
import HeroSlide from "./HeroSlide";
import HeroNavDots from "./HeroNavDots";
import TmdbImage from "@/components/images/TmdbImage";
interface HeroSpotlightProps {
    items: ScoredItem[];
    onSnooze: (contentId: string, durationHours?: number) => Promise<void>;
    onLogSignal: (contentId: string, signal: SignalType, value?: object) => Promise<void>;
    onNavigate?: (item: ScoredItem) => void;
}
interface State {
    current: number;
    isPaused: boolean;
}
type Action = {
    type: "advance";
} | {
    type: "prev";
} | {
    type: "goto";
    index: number;
} | {
    type: "pause";
} | {
    type: "resume";
};
const AUTO_ADVANCE_MS = 12000;
function reducer(state: State, action: Action, total: number): State {
    switch (action.type) {
        case "advance":
            return { ...state, current: (state.current + 1) % total };
        case "prev":
            return { ...state, current: (state.current - 1 + total) % total };
        case "goto":
            return { ...state, current: action.index, isPaused: false };
        case "pause":
            return { ...state, isPaused: true };
        case "resume":
            return { ...state, isPaused: false };
        default:
            return state;
    }
}
function HeroOnboarding() {
    return (<div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-4 rounded-[28px] border border-white/[0.08] bg-white/[0.02] px-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/8">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/40">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 6v6l4 2"/>
        </svg>
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/30">{uiMessage("ui.4a75d6d4deca")}</p>
        <h3 className="mt-2 text-xl font-black tracking-[-0.03em] text-white/70">{uiMessage("ui.8d6bcca28bf3")}</h3>
        <p className="mt-2 text-sm text-white/35">{uiMessage("ui.be5238b8d58e")}</p>
      </div>
    </div>);
}
function HeroPosterCluster({ currentItem, items, currentIndex, onNavigate, }: {
    currentItem: ScoredItem;
    items: ScoredItem[];
    currentIndex: number;
    onNavigate?: (item: ScoredItem) => void;
}) {
    const currentPoster = currentItem.poster_path;
    const currentTitle = currentItem.title?.trim().toLowerCase();
    const stackItems = items
        .filter((item, index) => {
        if (index === currentIndex)
            return false;
        return item.poster_path !== currentPoster && item.title?.trim().toLowerCase() !== currentTitle;
    })
        .slice(0, 3);
    return (<div className="pointer-events-none absolute right-12 top-1/2 z-20 hidden -translate-y-1/2 xl:block group-hover:translate-x-2 transition-transform duration-500">
      <div className="relative h-[390px] w-[260px]">
        {stackItems.map((item, index) => {
            const offsetX = 38 + index * 18;
            const offsetY = 24 + index * 28;
            const rotate = index === 0 ? 6 : index === 1 ? -5 : 4;
            const scale = 0.82 - index * 0.06;
            return (<button key={item.content_id} type="button" onClick={() => onNavigate?.(item)} className="pointer-events-auto absolute right-0 top-0 overflow-hidden rounded-[22px] border border-white/[0.08] bg-white/[0.035] opacity-40 shadow-2xl transition-all duration-500 hover:opacity-100 hover:scale-[1.03] hover:blur-0 blur-[0.4px]" style={{
                    width: 145,
                    transform: `translate(${offsetX}px, ${offsetY}px) rotate(${rotate}deg) scale(${scale})`,
                    zIndex: 4 - index,
                }}>
              <div className="relative aspect-[2/3] overflow-hidden">
                <TmdbImage path={item.poster_path} kind="poster" size="card" alt="" fill className="object-cover" fallback={<div className="h-full w-full bg-white/[0.04]"/>}/>
                <div className="absolute inset-0 bg-black/35"/>
              </div>
            </button>);
        })}

        {/* Hero Poster Ativo da Direita */}
        <button type="button" onClick={() => onNavigate?.(currentItem)} className="pointer-events-auto absolute right-6 top-6 z-10 overflow-hidden rounded-[28px] border border-white/[0.18] bg-white/[0.055] shadow-[0_35px_100px_rgba(0,0,0,0.65)] backdrop-blur-xl transition-all duration-500 hover:-translate-y-1.5 hover:scale-[1.02] hover:border-white/[0.35]" style={{ width: 195 }}>
          <div className="relative aspect-[2/3] overflow-hidden">
            <TmdbImage path={currentItem.poster_path} kind="poster" size="detail" alt={currentItem.title} fill priority className="object-cover" fallback={<div className="h-full w-full bg-white/[0.04]"/>}/>
            <div className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-white/15"/>
          </div>
        </button>
      </div>
    </div>);
}
export default function HeroSpotlight({ items, onSnooze, onLogSignal, onNavigate, }: HeroSpotlightProps) {
    const total = items.length;
    const [state, dispatch] = useReducer((s: State, a: Action) => reducer(s, a, Math.max(total, 1)), { current: 0, isPaused: false });
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const visibleSinceRef = useRef<number>(Date.now());
    const current = Math.min(state.current, Math.max(total - 1, 0));
    const item = items[current];
    const startTimer = useCallback(() => {
        if (timerRef.current)
            clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            dispatch({ type: "advance" });
        }, AUTO_ADVANCE_MS);
    }, []);
    const stopTimer = useCallback(() => {
        if (timerRef.current)
            clearTimeout(timerRef.current);
    }, []);
    useEffect(() => {
        if (total === 0)
            return;
        if (state.isPaused)
            return;
        visibleSinceRef.current = Date.now();
        startTimer();
        return () => stopTimer();
    }, [current, total, state.isPaused, startTimer, stopTimer]);
    const handleDotChange = useCallback((index: number) => {
        stopTimer();
        dispatch({ type: "goto", index });
    }, [stopTimer]);
    useEffect(() => {
        function onKey(event: KeyboardEvent) {
            if (total === 0)
                return;
            if (event.key === "ArrowRight")
                dispatch({ type: "advance" });
            if (event.key === "ArrowLeft")
                dispatch({ type: "prev" });
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [current, total]);
    const handleNotNow = useCallback(async () => {
        if (!item)
            return;
        stopTimer();
        await onSnooze(item.content_id, 4);
        await onLogSignal(item.content_id, "clicked_not_now");
        dispatch({ type: "advance" });
    }, [item, onSnooze, onLogSignal, stopTimer]);
    const handleCTAClick = useCallback(async () => {
        if (!item)
            return;
        const visibleSeconds = Math.round((Date.now() - visibleSinceRef.current) / 1000);
        await onLogSignal(item.content_id, "clicked_hero", {
            cta: "primary",
            position: current + 1,
            visible_seconds: visibleSeconds,
        });
        onNavigate?.(item);
    }, [item, current, onLogSignal, onNavigate]);
    const handleBannerClick = useCallback(() => {
        if (!item)
            return;
        onNavigate?.(item);
    }, [item, onNavigate]);
    if (total === 0)
        return <HeroOnboarding />;
    return (<div className="group relative h-[430px] w-full overflow-hidden rounded-[24px] max-[360px]:h-[455px] sm:h-[clamp(460px,46vw,620px)] sm:rounded-[28px]" onMouseEnter={() => dispatch({ type: "pause" })} onMouseLeave={() => dispatch({ type: "resume" })}>
      <div className="absolute inset-0 z-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-fuchsia-500/10"/>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={item?.content_id ?? current} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6, ease: "easeInOut" }}>
          {item ? (<HeroSlide item={item} onNotNow={handleNotNow} onCTAClick={handleCTAClick} onNavigate={handleBannerClick}/>) : null}
        </motion.div>
      </AnimatePresence>

      {item ? (<HeroPosterCluster currentItem={item} items={items} currentIndex={current} onNavigate={onNavigate}/>) : null}

      {/* ── SETAS LATERAIS DE NAVEGAÇÃO EDITORIAL (MELHORIA DE LAYOUT) ── */}
      {total > 1 && (<>
          <button type="button" onClick={() => dispatch({ type: "prev" })} className="absolute left-4 top-1/2 z-30 hidden -translate-y-1/2 rounded-full border border-white/10 bg-black/40 p-3 text-white/50 opacity-0 backdrop-blur-md transition-all duration-300 hover:bg-black/60 hover:text-white group-hover:opacity-100 md:flex" aria-label={uiMessage("ui.5486d30276b3")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <button type="button" onClick={() => dispatch({ type: "advance" })} className="absolute right-4 top-1/2 z-30 hidden -translate-y-1/2 rounded-full border border-white/10 bg-black/40 p-3 text-white/50 opacity-0 backdrop-blur-md transition-all duration-300 hover:bg-black/60 hover:text-white group-hover:opacity-100 md:flex" aria-label={uiMessage("ui.f6d421b3bc20")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
            </svg>
          </button>
        </>)}

      {total > 1 ? (<div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2 md:bottom-6 md:left-8 md:translate-x-0">
          <HeroNavDots count={total} current={current} onChange={handleDotChange}/>
        </div>) : null}

      {total > 1 && !state.isPaused ? (<div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-white/5">
          <motion.div key={`progress-${current}`} className="h-full bg-white/40" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: AUTO_ADVANCE_MS / 1000, ease: "linear" }}/>
        </div>) : null}
    </div>);
}


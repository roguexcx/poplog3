"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ScoredItem, SignalType } from "./types";
import HeroSlide from "./HeroSlide";
import HeroNavDots from "./HeroNavDots";

interface HeroSpotlightProps {
  items: ScoredItem[];
  onSnooze: (contentId: string, durationHours?: number) => Promise<void>;
  onLogSignal: (
    contentId: string,
    signal: SignalType,
    value?: object
  ) => Promise<void>;
  onNavigate?: (item: ScoredItem) => void;
}

interface State {
  current: number;
  isPaused: boolean;
}

type Action =
  | { type: "advance" }
  | { type: "goto"; index: number }
  | { type: "pause" }
  | { type: "resume" };

const AUTO_ADVANCE_MS = 12_000;

function reducer(state: State, action: Action, total: number): State {
  switch (action.type) {
    case "advance":
      return { ...state, current: (state.current + 1) % total };
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
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-4 rounded-[28px] border border-white/[0.08] bg-white/[0.02] px-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/8">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-white/40"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </div>

      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/30">
          Nada por aqui ainda
        </p>

        <h3 className="mt-2 text-xl font-black tracking-[-0.03em] text-white/70">
          Adicione séries e filmes
        </h3>

        <p className="mt-2 text-sm text-white/35">
          Sua vitrine pessoal aparece assim que você começar a acompanhar algum
          título.
        </p>
      </div>
    </div>
  );
}

function HeroPosterCluster({
  currentItem,
  items,
  currentIndex,
  onNavigate,
}: {
  currentItem: ScoredItem;
  items: ScoredItem[];
  currentIndex: number;
  onNavigate?: (item: ScoredItem) => void;
}) {
  const currentPoster = currentItem.poster_path;
  const currentTitle = currentItem.title?.trim().toLowerCase();

  const stackItems = items
    .filter((item, index) => {
      if (index === currentIndex) return false;

      const samePoster =
        currentPoster && item.poster_path && item.poster_path === currentPoster;

      const sameTitle =
        currentTitle && item.title?.trim().toLowerCase() === currentTitle;

      return !samePoster && !sameTitle;
    })
    .slice(0, 3);

  return (
    <div className="pointer-events-none absolute right-8 top-1/2 z-20 hidden -translate-y-1/2 xl:block">
      <div className="relative h-[390px] w-[260px]">
        {stackItems.map((item, index) => {
          const offsetX = 34 + index * 16;
          const offsetY = 32 + index * 26;
          const rotate = index === 0 ? 5 : index === 1 ? -4 : 3;
          const scale = 0.78 - index * 0.05;

          return (
            <button
              key={item.content_id}
              type="button"
              onClick={() => onNavigate?.(item)}
              className="pointer-events-auto absolute right-0 top-0 overflow-hidden rounded-[22px] border border-white/[0.08] bg-white/[0.035] opacity-55 shadow-2xl shadow-black/50 blur-[0.2px] transition-all duration-500 hover:opacity-100 hover:blur-0"
              style={{
                width: 150,
                transform: `translate(${offsetX}px, ${offsetY}px) rotate(${rotate}deg) scale(${scale})`,
                zIndex: 4 - index,
              }}
              aria-label={`Abrir ${item.title}`}
            >
              <div className="relative aspect-[2/3] overflow-hidden">
                {item.poster_path ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w342${item.poster_path}`}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-full w-full bg-white/[0.04]" />
                )}

                <div className="absolute inset-0 bg-black/25" />
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => onNavigate?.(currentItem)}
          className="pointer-events-auto absolute right-5 top-8 z-10 overflow-hidden rounded-[28px] border border-white/[0.16] bg-white/[0.055] shadow-[0_30px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl transition-all duration-500 hover:-translate-y-1 hover:border-white/[0.28]"
          style={{ width: 190 }}
          aria-label={`Abrir ${currentItem.title}`}
        >
          <div className="relative aspect-[2/3] overflow-hidden">
            {currentItem.poster_path ? (
              <img
                src={`https://image.tmdb.org/t/p/w500${currentItem.poster_path}`}
                alt={currentItem.title}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="h-full w-full bg-white/[0.04]" />
            )}

            <div className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-white/10" />
          </div>
        </button>
      </div>
    </div>
  );
}

export default function HeroSpotlight({
  items,
  onSnooze,
  onLogSignal,
  onNavigate,
}: HeroSpotlightProps) {
  const total = items.length;

  const [state, dispatch] = useReducer(
    (s: State, a: Action) => reducer(s, a, Math.max(total, 1)),
    { current: 0, isPaused: false }
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleSinceRef = useRef<number>(Date.now());

  const current = Math.min(state.current, Math.max(total - 1, 0));
  const item = items[current];

  const startTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(() => {
      dispatch({ type: "advance" });
    }, AUTO_ADVANCE_MS);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (total === 0) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (prefersReduced || state.isPaused) return;

    visibleSinceRef.current = Date.now();
    startTimer();

    return () => stopTimer();
  }, [current, total, state.isPaused, startTimer, stopTimer]);

  const handleDotChange = useCallback(
    (index: number) => {
      stopTimer();
      dispatch({ type: "goto", index });
    },
    [stopTimer]
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (total === 0) return;

      if (event.key === "ArrowRight") {
        dispatch({ type: "advance" });
      }

      if (event.key === "ArrowLeft") {
        dispatch({
          type: "goto",
          index: (current - 1 + total) % total,
        });
      }
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [current, total]);

  const handleNotNow = useCallback(async () => {
    if (!item) return;

    stopTimer();

    await onSnooze(item.content_id, 4);
    await onLogSignal(item.content_id, "clicked_not_now");

    dispatch({ type: "advance" });
  }, [item, onSnooze, onLogSignal, stopTimer]);

  const handleCTAClick = useCallback(async () => {
    if (!item) return;

    const visibleSeconds = Math.round(
      (Date.now() - visibleSinceRef.current) / 1000
    );

    await onLogSignal(item.content_id, "clicked_hero", {
      cta: "primary",
      position: current + 1,
      visible_seconds: visibleSeconds,
    });

    onNavigate?.(item);
  }, [item, current, onLogSignal, onNavigate]);

  if (total === 0) return <HeroOnboarding />;

  return (
    <div
      className="group relative w-full overflow-hidden rounded-[28px]"
      style={{
        minHeight: 440,
        height: "clamp(440px, 46vw, 620px)",
      }}
      onMouseEnter={() => dispatch({ type: "pause" })}
      onMouseLeave={() => dispatch({ type: "resume" })}
    >
      <div className="absolute inset-0 z-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-fuchsia-500/10" />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={item?.content_id ?? current}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 0.6,
            ease: "easeInOut",
          }}
        >
          {item ? (
            <HeroSlide
              item={item}
              onNotNow={handleNotNow}
              onCTAClick={handleCTAClick}
            />
          ) : null}
        </motion.div>
      </AnimatePresence>

      {item ? (
        <HeroPosterCluster
          currentItem={item}
          items={items}
          currentIndex={current}
          onNavigate={onNavigate}
        />
      ) : null}

      {total > 1 ? (
        <div className="pointer-events-auto absolute bottom-5 left-1/2 z-20 -translate-x-1/2 md:bottom-6 md:left-8 md:translate-x-0">
          <HeroNavDots
            count={total}
            current={current}
            onChange={handleDotChange}
          />
        </div>
      ) : null}

      {total > 1 && !state.isPaused ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-white/5">
          <motion.div
            key={`progress-${current}`}
            className="h-full bg-white/40"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{
              duration: AUTO_ADVANCE_MS / 1000,
              ease: "linear",
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
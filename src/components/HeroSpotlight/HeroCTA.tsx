"use client";

import type { HeroCTA as HeroCTAType } from "./types";

interface HeroCTAProps {
  cta: HeroCTAType;
  onPrimary: () => void;
  onNotNow: () => void;
}

function PlayIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M3 2.5l10 5.5-10 5.5V2.5z" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 1l1.5 3.5L13 6l-3.5 1.5L8 11l-1.5-3.5L3 6l3.5-1.5L8 1z" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M2 1h1v14H2V1zm1 1l9 3-9 3V2z" />
    </svg>
  );
}

const ICONS = {
  play: PlayIcon,
  sparkles: SparklesIcon,
  flag: FlagIcon,
};

export default function HeroCTA({
  cta,
  onPrimary,
  onNotNow,
}: HeroCTAProps) {
  const Icon = ICONS[cta.icon];

  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 max-[360px]:grid-cols-1 sm:flex sm:w-auto sm:flex-wrap sm:gap-3">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onPrimary(); }}
        className="group relative min-w-0 overflow-hidden rounded-xl bg-white px-3.5 py-2.5 text-xs font-black tracking-[-0.02em] text-black shadow-2xl shadow-white/10 transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/95 active:scale-[0.98] max-[360px]:w-full sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white to-zinc-200 opacity-90" />

        <div className="relative flex min-w-0 items-center justify-center gap-2 sm:gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/10 transition-transform duration-300 group-hover:scale-110">
            <Icon />
          </span>

          <span className="truncate max-[360px]:whitespace-normal">{cta.primary}</span>
        </div>
      </button>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onNotNow(); }}
        className="group rounded-xl border border-white/[0.12] bg-white/[0.05] px-3 py-2.5 text-xs font-semibold text-white/72 shadow-xl shadow-black/20 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.2] hover:bg-white/[0.08] hover:text-white max-[360px]:w-full sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm"
      >
        <span className="transition-opacity duration-300 group-hover:opacity-100">
          Não agora
        </span>
      </button>
    </div>
  );
}

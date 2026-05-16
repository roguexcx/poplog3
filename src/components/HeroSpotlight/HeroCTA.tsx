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
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onPrimary(); }}
        className="group relative overflow-hidden rounded-2xl bg-white px-5 py-3 text-sm font-black tracking-[-0.02em] text-black shadow-2xl shadow-white/10 transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/95 active:scale-[0.98]"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white to-zinc-200 opacity-90" />

        <div className="relative flex items-center gap-2.5">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/10 transition-transform duration-300 group-hover:scale-110">
            <Icon />
          </span>

          <span>{cta.primary}</span>
        </div>
      </button>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onNotNow(); }}
        className="group rounded-2xl border border-white/[0.12] bg-white/[0.05] px-4 py-3 text-sm font-semibold text-white/72 shadow-xl shadow-black/20 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.2] hover:bg-white/[0.08] hover:text-white"
      >
        <span className="transition-opacity duration-300 group-hover:opacity-100">
          Não agora
        </span>
      </button>
    </div>
  );
}
"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import type { ScoredItem } from "./types";
import HeroCTA from "./HeroCTA";

interface HeroSlideProps {
  item: ScoredItem;
  onNotNow: () => void;
  onCTAClick: () => void;
  onNavigate: () => void;
}

function ProgressBar({
  value,
  max,
  color = "#a07ee0",
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/12">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

function ProgressContext({ item }: { item: ScoredItem }) {
  if (item.content_type === "filme") {
    const runtime = item.runtime ?? 0;
    const progress = item.watch_progress_minutes ?? 0;

    if (!runtime || progress <= 0) {
      return (
        <div className="flex items-center gap-2 text-sm text-white/50">
          <div className="h-1 w-16 rounded-full bg-white/12" />
          <span>Pronto para assistir</span>
        </div>
      );
    }

    const remaining = Math.max(runtime - progress, 0);
    const pct = Math.round((progress / runtime) * 100);
    const mins = remaining % 60;

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-white/55">
          <span>{pct}% assistido</span>
          {remaining > 0 ? <span>Faltam {mins}min</span> : null}
        </div>
        <ProgressBar value={progress} max={runtime} color={(item as any).serverEyebrow?.color ?? "#a07ee0"} />
      </div>
    );
  }

  const total = item.total_episodes_season ?? 0;
  const watched = item.episodes_watched ?? 0;

  if (!total || watched <= 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/50">
        <div className="h-1 w-16 rounded-full bg-white/12" />
        <span>Pronto para continuar</span>
      </div>
    );
  }

  const remaining = Math.max(total - watched, 0);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-white/55">
        <span>
          {remaining} {remaining === 1 ? "episódio restante" : "episódios restantes"}
        </span>
        <span>
          {watched}/{total}
        </span>
      </div>
      <ProgressBar value={watched} max={total} color={(item as any).serverEyebrow?.color ?? "#a07ee0"} />
    </div>
  );
}

function NextEpisodeBox({ item }: { item: ScoredItem }) {
  if (item.content_type !== "serie" || !item.current_season) return null;

  const episode = (item.current_episode ?? 0) + 1;
  const season = item.current_season ?? 1;
  const episodeName = item.next_episode_name ?? `Episódio ${episode}`;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-3 backdrop-blur-sm">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/8">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="white" opacity={0.7}>
          <path d="M3 2.5l10 5.5-10 5.5V2.5z" />
        </svg>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
          T{season}E{episode} · PRÓXIMO DA CONTINUIDADE
        </p>
        <p className="mt-0.5 truncate text-sm font-semibold text-white/90">
          {episodeName}
        </p>
      </div>
    </div>
  );
}

export default function HeroSlide({
  item,
  onNotNow,
  onCTAClick,
  onNavigate,
}: HeroSlideProps) {
  const eyebrow = (item as any).serverEyebrow ?? { text: "CURADORIA", color: "#a07ee0" };
  const cta = (item as any).serverCta ?? { primary: "Assistir agora", icon: "play" };

  const backdropUrl = item.backdrop_path ? `https://image.tmdb.org/t/p/original${item.backdrop_path}` : null;
  const stillUrl = item.next_episode_still_path ? `https://image.tmdb.org/t/p/w1280${item.next_episode_still_path}` : null;
  const dominantColor = item.dominant_color ?? "#1a1a2e";
  const glowRgb = hexToRgb(dominantColor);

  const genres = Array.isArray(item.genres) ? item.genres.join(" · ") : "";
  const platform = item.streaming_platform ?? "";
  const yearStr = item.year?.toString() ?? "";

  // Alterna entre backdrop e still a cada 6 segundos quando ambos estão disponíveis
  const [showStill, setShowStill] = useState(false);
  useEffect(() => {
    setShowStill(false);
    if (!backdropUrl || !stillUrl) return;
    const id = setInterval(() => setShowStill((s) => !s), 6000);
    return () => clearInterval(id);
  }, [item.content_id, backdropUrl, stillUrl]);

  return (
    <div
      className="relative h-full w-full cursor-pointer overflow-hidden"
      onClick={onNavigate}
    >
      {/* Camada backdrop */}
      {backdropUrl ? (
        <div
          className="absolute inset-0 transition-opacity duration-[1200ms] ease-in-out"
          style={{ opacity: showStill ? 0 : 1 }}
        >
          <Image
            src={backdropUrl}
            alt=""
            fill
            className="object-cover object-center"
            priority
            sizes="100vw"
          />
        </div>
      ) : null}

      {/* Camada still do episódio */}
      {stillUrl ? (
        <div
          className="absolute inset-0 transition-opacity duration-[1200ms] ease-in-out"
          style={{ opacity: showStill ? 1 : 0 }}
        >
          <Image
            src={stillUrl}
            alt=""
            fill
            className="object-cover object-center"
            sizes="100vw"
          />
        </div>
      ) : null}

      {/* Fallback gradiente quando não há imagem */}
      {!backdropUrl && !stillUrl ? (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${dominantColor} 0%, #0a0b0f 100%)`,
          }}
        />
      ) : null}

      {glowRgb ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(ellipse 70% 60% at 65% 50%, rgba(${glowRgb},0.15) 0%, transparent 70%)`,
          }}
        />
      ) : null}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/78 via-black/22 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0a0b0f] via-transparent to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 to-transparent" />

      <div className="relative flex h-full flex-col justify-end">
        <div className="flex max-w-[720px] flex-col justify-end gap-4 p-5 pb-6 md:p-8 md:pb-10 lg:p-12 lg:pb-12 xl:max-w-[58%]">
          <div className="flex items-center gap-2">
            <span
              className="h-1 w-5 rounded-full"
              style={{ background: eyebrow.color }}
            />
            <span
              className="text-[10px] font-black uppercase tracking-[0.22em]"
              style={{ color: eyebrow.color }}
            >
              {eyebrow.text}
            </span>
          </div>

          <h2 className="text-2xl font-black leading-none tracking-[-0.04em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)] sm:text-3xl md:text-4xl lg:text-[2.75rem]">
            {item.title}
          </h2>

          <div className="flex flex-wrap items-center gap-1.5 text-xs text-white/55">
            {yearStr ? <span>{yearStr}</span> : null}

            {genres ? (
              <>
                {yearStr ? <span className="text-white/25">·</span> : null}
                <span>{genres}</span>
              </>
            ) : null}

            {platform ? (
              <>
                {yearStr || genres ? (
                  <span className="text-white/25">·</span>
                ) : null}
                <span className="rounded-md bg-white/10 px-2 py-0.5 font-medium text-white/70">
                  {platform}
                </span>
              </>
            ) : null}
          </div>

          <ProgressContext item={item} />
          <NextEpisodeBox item={item} />
          <HeroCTA cta={cta} onPrimary={onCTAClick} onNotNow={onNotNow} />
        </div>
      </div>
    </div>
  );
}

function hexToRgb(hex: string): string | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  return `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}`;
}
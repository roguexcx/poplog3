"use client";

import Image from "next/image";
import type { ScoredItem } from "./types";
import { getHeroCTA, getHeroEyebrow, tmdbImage } from "@/lib/curadoria-engine";
import HeroCTA from "./HeroCTA";

interface HeroSlideProps {
  item: ScoredItem;
  onNotNow: () => void;
  onCTAClick: () => void;
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

    const hours = Math.floor(remaining / 60);
    const mins = remaining % 60;

    const timeStr =
      hours > 0
        ? `${hours}h${mins > 0 ? `${mins}min` : ""}`
        : `${mins}min`;

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-white/55">
          <span>{pct}% assistido</span>
          {remaining > 0 ? <span>Faltam {timeStr}</span> : null}
        </div>

        <ProgressBar value={progress} max={runtime} color="#a07ee0" />
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
  const duration = item.next_episode_duration ?? 0;
  const totalRemainingMinutes = remaining * duration;

  const hours = Math.floor(totalRemainingMinutes / 60);
  const mins = totalRemainingMinutes % 60;

  const timeStr =
    totalRemainingMinutes > 0
      ? hours > 0
        ? `~${hours}h${mins > 0 ? `${mins}min` : ""}`
        : `~${mins}min`
      : "";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-white/55">
        <span>
          {remaining} {remaining === 1 ? "episódio" : "episódios"} restantes
          {timeStr ? ` · ${timeStr}` : ""}
        </span>

        <span>
          {watched}/{total}
        </span>
      </div>

      <ProgressBar value={watched} max={total} color="#a07ee0" />
    </div>
  );
}

function NextEpisodeBox({ item }: { item: ScoredItem }) {
  if (!item.next_episode_name) return null;

  const duration = item.next_episode_duration;
  const airDate = item.next_episode_air_date;
  const episode = (item.current_episode ?? 0) + 1;
  const season = item.current_season ?? 1;

  let timeLabel: string | null = null;

  if (item.new_episode_available) {
    timeLabel = "Disponível agora";
  } else if (airDate) {
    const date = new Date(airDate);
    const now = new Date();

    if (date > now) {
      const diffDays = Math.ceil(
        (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      timeLabel = diffDays === 1 ? "Amanhã" : `Em ${diffDays} dias`;
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-3 backdrop-blur-sm">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/8">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="white"
          opacity={0.7}
        >
          <path d="M3 2.5l10 5.5-10 5.5V2.5z" />
        </svg>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
          T{season}E{episode} · Próximo
        </p>

        <p className="mt-0.5 truncate text-sm font-semibold text-white/90">
          {item.next_episode_name}
        </p>

        <div className="mt-1 flex items-center gap-2">
          {duration ? (
            <span className="text-[11px] text-white/45">
              {duration >= 60
                ? `${Math.floor(duration / 60)}h${
                    duration % 60 > 0 ? `${duration % 60}min` : ""
                  }`
                : `${duration}min`}
            </span>
          ) : null}

          {timeLabel ? (
            <>
              {duration ? <span className="text-white/25">·</span> : null}

              <span
                className="text-[11px] font-medium"
                style={{
                  color: item.new_episode_available ? "#2daa88" : "#a07ee0",
                }}
              >
                {timeLabel}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatGenres(genres: unknown) {
  if (!Array.isArray(genres)) return "";

  return genres
    .slice(0, 2)
    .map((genre) => {
      if (typeof genre === "string") return genre;

      if (genre && typeof genre === "object") {
        const maybeGenre = genre as { name?: unknown };

        if (typeof maybeGenre.name === "string") {
          return maybeGenre.name;
        }
      }

      return null;
    })
    .filter((genre): genre is string => Boolean(genre))
    .join(" · ");
}

export default function HeroSlide({
  item,
  onNotNow,
  onCTAClick,
}: HeroSlideProps) {
  const cta = getHeroCTA(item);
  const eyebrow = getHeroEyebrow(item);
  const backdropUrl = tmdbImage(item.backdrop_path, "original");
  const dominantColor = item.dominant_color ?? "#1a1a2e";
  const glowRgb = hexToRgb(dominantColor);

  const genres = formatGenres(item.genres);
  const platform = item.streaming_platform ?? "";
  const yearStr = item.year?.toString() ?? "";

  return (
    <div className="relative h-full w-full overflow-hidden">
      {backdropUrl ? (
        <div className="absolute inset-0">
          <Image
            src={backdropUrl}
            alt=""
            fill
            className="object-cover object-center"
            priority
            sizes="100vw"
          />
        </div>
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${dominantColor} 0%, #0a0b0f 100%)`,
          }}
        />
      )}

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

  return `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(
    result[3],
    16
  )}`;
}
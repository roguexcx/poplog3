"use client";

import { ChevronLeft, ChevronRight, Play, Sparkles } from "lucide-react";
import Image from "next/image";
import { useRef } from "react";

import type { WatchlistPickItem } from "@/features/acompanhando/WatchlistPickCard";

type Props = {
  items: WatchlistPickItem[];
  loading?: boolean;
  onPick: (item: WatchlistPickItem) => void;
};

function tmdbImage(path: string | null, size: "w780" | "original" = "w780") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function ProviderPill({ item }: { item: WatchlistPickItem }) {
  if (!item.best_provider_name) return null;

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/[0.12] bg-black/35 px-2.5 py-1 text-[11px] font-bold text-white/80 backdrop-blur-md">
      {item.best_provider_logo ? (
        <Image
          src={tmdbImage(item.best_provider_logo, "original") ?? ""}
          alt=""
          width={16}
          height={16}
          className="h-4 w-4 rounded object-contain"
          loading="lazy"
        />
      ) : null}
      <span className="truncate">{item.best_provider_name}</span>
    </span>
  );
}

function QuickFacts({ item }: { item: WatchlistPickItem }) {
  const facts = [
    item.series_status,
    item.number_of_seasons
      ? `${item.number_of_seasons} ${item.number_of_seasons === 1 ? "temporada" : "temporadas"}`
      : null,
    item.number_of_episodes
      ? `${item.number_of_episodes} episódios`
      : null,
    item.total_runtime_label,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-white/62">
      {facts.map((fact) => (
        <span key={fact} className="rounded-full bg-white/[0.07] px-2.5 py-1">
          {fact}
        </span>
      ))}
    </div>
  );
}

function StartSeriesCard({
  item,
  onPick,
}: {
  item: WatchlistPickItem;
  onPick: (item: WatchlistPickItem) => void;
}) {
  const backdropUrl = tmdbImage(item.backdrop_path, "original");
  const posterUrl = tmdbImage(item.poster_path, "w780");
  const badges = [
    ...(item.contextual_badges ?? []),
    ...(item.award_badges ?? []),
  ].slice(0, 6);

  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      className="group relative min-h-[360px] w-[min(92vw,900px)] shrink-0 snap-start overflow-hidden rounded-[24px] border border-white/[0.10] bg-zinc-950 text-left shadow-[0_24px_80px_rgba(0,0,0,0.42)] transition-all hover:border-white/[0.18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 md:min-h-[410px]"
    >
      {backdropUrl ? (
        <Image
          src={backdropUrl}
          alt=""
          fill
          sizes="(min-width: 1024px) 900px, 92vw"
          className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-700 group-hover:scale-[1.025] group-hover:opacity-82"
          loading="lazy"
        />
      ) : posterUrl ? (
        <Image
          src={posterUrl}
          alt=""
          fill
          sizes="(min-width: 1024px) 900px, 92vw"
          className="absolute inset-0 h-full w-full object-cover opacity-55 blur-[2px] transition duration-700 group-hover:scale-[1.025]"
          loading="lazy"
        />
      ) : null}

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_30%,rgba(250,204,21,0.20),transparent_28rem)]" />
      <div className="absolute inset-0 bg-gradient-to-r from-black via-zinc-950/80 to-zinc-950/18" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/28 to-transparent" />

      <div className="relative flex min-h-[360px] flex-col justify-between p-5 md:min-h-[410px] md:p-7 lg:max-w-[68%]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/20 bg-amber-300/12 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-100">
            <Sparkles className="h-3.5 w-3.5" />
            Boa hora pra começar
          </span>
          <ProviderPill item={item} />
        </div>

        <div className="mt-10 md:mt-14">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {badges.map((badge) => (
              <span
                key={badge}
                className="rounded-full border border-white/[0.10] bg-white/[0.08] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/68 backdrop-blur-md"
              >
                {badge}
              </span>
            ))}
          </div>

          <h3 className="max-w-[14ch] text-4xl font-black leading-[0.95] tracking-[-0.03em] text-white sm:text-5xl md:max-w-[16ch] md:text-6xl">
            {item.original_title && item.original_title !== item.title
              ? item.original_title
              : item.title}
          </h3>
          {item.original_title && item.original_title !== item.title && (
            <p className="mt-2 text-[13px] font-medium text-white/40 leading-tight">
              {item.title}
            </p>
          )}

          <p className="mt-4 line-clamp-3 max-w-2xl text-sm leading-6 text-white/68 md:text-[15px]">
            {item.overview ?? item.editorial_reason}
          </p>

          {item.editorial_reason && item.overview && (
            <p className="mt-3 max-w-xl text-[13px] font-semibold leading-5 text-amber-100/78">
              {item.editorial_reason}
            </p>
          )}

          <div className="mt-5">
            <QuickFacts item={item} />
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[12px] font-black text-zinc-950 shadow-[0_10px_30px_rgba(255,255,255,0.16)]">
            <Play className="h-4 w-4 fill-current" />
            Começar série
          </span>
          {item.genres?.length ? (
            <span className="text-[12px] font-semibold text-white/48">
              {item.genres.join(" / ")}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

export default function StartSeriesBanner({ items, loading, onPick }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);

  function scrollBy(direction: 1 | -1) {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({
      left: direction * Math.min(row.clientWidth * 0.92, 900),
      behavior: "smooth",
    });
  }

  if (loading) {
    return (
      <div className="h-[360px] animate-pulse rounded-[24px] border border-white/[0.08] bg-white/[0.04] md:h-[410px]" />
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="relative">
      <div
        ref={rowRef}
        className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pr-2"
      >
        {items.map((item) => (
          <StartSeriesCard key={item.content_id} item={item} onPick={onPick} />
        ))}
      </div>

      {items.length > 1 && (
        <div className="pointer-events-none absolute inset-y-0 right-3 hidden items-center gap-2 lg:flex">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-white/[0.14] bg-black/45 text-white/70 backdrop-blur-md transition hover:text-white"
            aria-label="Sugestão anterior"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-white/[0.14] bg-black/45 text-white/70 backdrop-blur-md transition hover:text-white"
            aria-label="Próxima sugestão"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}

// src/components/posters/PosterCard.tsx

"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { useWatchlistToggle } from "@/hooks/useWatchlistToggle";
import { useWatchedToggle } from "@/hooks/useWatchedToggle";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import type { TMDBItem, TMDBMediaType } from "@/types/tmdb";
import {
  getOriginalTitle,
  getMediaLabel,
  getPosterUrl,
  getRating,
  getReleaseYear,
  getTitle,
} from "@/lib/tmdb-utils";

type Props = {
  item: TMDBItem;
  priority?: boolean;
};

// ─── Ícones ───────────────────────────────────────────────────────────────────

function IconBookmark({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[13px] w-[13px]"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2.2}
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[13px] w-[13px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconStar() {
  return (
    <svg viewBox="0 0 24 24" className="h-[9px] w-[9px]" fill="#fbbf24">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

// ─── Botão de ação reutilizável ───────────────────────────────────────────────

type ActionButtonProps = {
  onClick: () => void;
  disabled: boolean;
  title: string;
  active: boolean;
  saving: boolean;
  activeClass: string;
  children: ReactNode;
};

function ActionButton({
  onClick,
  disabled,
  title,
  active,
  saving,
  activeClass,
  children,
}: ActionButtonProps) {
  const unavailable = disabled || saving;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (unavailable) return;

        onClick();
      }}
      title={saving ? "Salvando..." : title}
      aria-busy={saving}
      aria-disabled={unavailable}
      className={[
        "grid h-[30px] w-[30px] place-items-center rounded-full border backdrop-blur-[10px]",
        "transition-[transform,background,border-color,box-shadow,opacity] duration-200",
        saving ? "cursor-wait opacity-90" : "cursor-pointer hover:scale-110",
        disabled && !saving ? "opacity-60" : "",
        active
          ? activeClass
          : "border-white/[0.18] bg-black/[0.72] text-white/85 hover:border-violet-500/60 hover:shadow-[0_0_12px_rgba(139,92,246,0.3)]",
      ].join(" ")}
    >
      {saving ? (
        <span className="h-[12px] w-[12px] animate-spin rounded-full border border-current border-t-transparent" />
      ) : (
        children
      )}
    </button>
  );
}

// ─── PosterCard ───────────────────────────────────────────────────────────────

export default function PosterCard({ item, priority = false }: Props) {
  const title = getTitle(item);
  const originalTitle = getOriginalTitle(item);
  const year = getReleaseYear(item);
  const rating = getRating(item);
  const posterUrl = getPosterUrl(item.poster_path, "w500");

  const type: TMDBMediaType = item.media_type === "tv" ? "tv" : "movie";
  const mediaLabel = getMediaLabel({ ...item, media_type: type });

  const releaseYear = year !== "----" ? Number(year) : null;

  const sharedProps = {
    tmdbId: item.id,
    mediaType: type,
    title,
    releaseYear,
  };

  const watchlist = useWatchlistToggle(sharedProps);
  const watched = useWatchedToggle(sharedProps);

  return (
    <article className="group block">
      {/* Poster */}
      <div className="relative">
        <Link href={`/title/${type}/${item.id}`} className="block">
          <div
            className={[
              "relative aspect-[2/3] overflow-hidden rounded-[14px] bg-[#0e0e1a]",
              "transition-transform duration-[400ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)]",
              "group-hover:-translate-y-1 ring-1 ring-white/[0.08]",
              "before:absolute before:inset-0 before:rounded-[14px] before:p-px",
              "before:bg-gradient-to-br before:from-white/10 before:via-white/[0.04] before:to-white/[0.01]",
              "before:[mask-composite:exclude] before:[webkit-mask-composite:destination-out]",
              "before:[mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)]",
              "after:absolute after:inset-0 after:rounded-[14px] after:p-px after:opacity-0",
              "after:bg-gradient-to-br after:from-violet-500/55 after:via-sky-400/35 after:to-violet-500/15",
              "after:[mask-composite:exclude] after:[webkit-mask-composite:destination-out]",
              "after:[mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)]",
              "after:transition-opacity after:duration-350 group-hover:after:opacity-100",
            ].join(" ")}
          >
            {posterUrl ? (
              <Image
                src={posterUrl}
                alt={title}
                fill
                priority={priority}
                sizes="(max-width: 768px) 150px, 180px"
                className="object-cover brightness-[0.92] saturate-[1.05] transition-[transform,filter] duration-[600ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)] group-hover:scale-[1.04] group-hover:brightness-100 group-hover:saturate-110"
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-[#0e0e1a] text-[11px] text-[#3a3a55]">
                Sem imagem
              </div>
            )}

            <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black/70 via-transparent to-black/25" />
            <div className="pointer-events-none absolute inset-0 z-[3] bg-[radial-gradient(ellipse_at_50%_110%,rgba(99,102,241,0.22),transparent_65%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

            {/* Badge de tipo */}
            <div className="absolute bottom-2.5 left-2.5 z-20 rounded-[5px] border border-violet-500/40 bg-violet-500/[0.18] px-[7px] py-[2px] text-[9px] font-semibold uppercase tracking-[0.08em] text-violet-300 backdrop-blur-[8px]">
              {mediaLabel}
            </div>
          </div>
        </Link>

        {/* Botões de ação */}
        <div className="absolute left-2.5 top-2.5 z-20 flex flex-col gap-1.5">
          <ActionButton
            onClick={watchlist.toggle}
            disabled={watchlist.loading || !watchlist.isLoggedIn}
            title={watchlist.inWatchlist ? "Remover da watchlist" : "Adicionar à watchlist"}
            active={watchlist.inWatchlist}
            saving={watchlist.saving}
            activeClass="border-sky-400/55 bg-sky-400/[0.18] text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.25)]"
          >
            <IconBookmark filled={watchlist.inWatchlist} />
          </ActionButton>

          <ActionButton
            onClick={watched.toggle}
            disabled={watched.loading || !watched.isLoggedIn}
            title={watched.isWatched ? "Desmarcar como assistido" : "Já vi"}
            active={watched.isWatched}
            saving={watched.saving}
            activeClass="border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]"
          >
            <IconCheck />
          </ActionButton>
        </div>

        {/* Rating */}
        {rating && (
          <div className="absolute right-2.5 top-2.5 z-20 flex items-center gap-[3px] rounded-full border border-white/[0.14] bg-black/75 px-2 py-[3px] text-[10px] font-semibold text-amber-400 backdrop-blur-[10px]">
            <IconStar />
            {rating}
          </div>
        )}
      </div>

      {/* Meta */}
      <Link href={`/title/${type}/${item.id}`} className="mt-2.5 block px-0.5">
        <LocalizedTitle
          as="h3"
          title={title}
          originalTitle={originalTitle}
          variant="poster"
          className="line-clamp-2 text-[13px] font-[500] leading-[1.35] tracking-[-0.01em] text-[#e8e8f0] transition-colors duration-200 group-hover:text-[#f4f4fa]"
        />

        <p className="mt-1 flex items-center gap-[5px] text-[11px] text-[#52526a]">
          {year !== "----" && <span>{year}</span>}

          {year !== "----" && (
            <span className="inline-block h-[2px] w-[2px] rounded-full bg-[#3a3a50]" />
          )}

          <span>{type === "tv" ? "Série" : "Filme"}</span>
        </p>
      </Link>
    </article>
  );
}

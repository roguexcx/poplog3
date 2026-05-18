"use client";

import Link from "next/link";

import { TmdbImageLegacy as TmdbImage } from "@/components/images/TmdbImage";
import { CardActionButton } from "@/components/ui/CardActionButton";
import { IconBookmark, IconCheck, IconX } from "@/components/ui/icons";
import { useUserFeedbackToggle } from "@/hooks/useUserFeedbackToggle";
import { useWatchedToggle } from "@/hooks/useWatchedToggle";
import { useWatchlistToggle } from "@/hooks/useWatchlistToggle";
import type { TitleCollection, TitleCollectionPart } from "./types";

type TitleCollectionSectionProps = {
  collection?: TitleCollection | null;
  currentTitleId?: number | null;
};

// ─── Horizontal card (≤ 3 films) ─────────────────────────────────────────────

function HorizontalCard({
  part,
  index,
  isCurrent,
}: {
  part: TitleCollectionPart;
  index: number;
  isCurrent: boolean;
}) {
  const releaseYear = part.year != null ? Number(String(part.year).slice(0, 4)) || undefined : undefined;
  const watchlist = useWatchlistToggle({ tmdbId: part.id, mediaType: "movie", title: part.title, releaseYear });
  const watched   = useWatchedToggle({ tmdbId: part.id, mediaType: "movie", title: part.title, releaseYear });
  const feedback  = useUserFeedbackToggle({ tmdbId: part.id, mediaType: "movie", source: "collection" });

  const href = isCurrent ? undefined : `/title/movie/${part.id}`;

  const inner = (
    <article className={[
      "group relative h-[120px] overflow-hidden rounded-[1.35rem] transition duration-300",
      "border bg-black/40 shadow-[0_10px_32px_rgba(0,0,0,0.35)]",
      isCurrent
        ? "border-indigo-400/40 shadow-[0_0_0_1px_rgba(99,102,241,0.25),0_10px_32px_rgba(0,0,0,0.35)]"
        : "border-white/[0.08] hover:-translate-y-0.5 hover:border-indigo-400/25 hover:shadow-[0_18px_52px_rgba(0,0,0,0.50)]",
    ].join(" ")}>

      {/* blurred poster as cinematic bg */}
      {part.posterPath && (
        <div className="absolute inset-0">
          <TmdbImage
            path={part.posterPath}
            fallbackPath={null}
            size="w500"
            alt=""
            fallbackLabel=""
            className="h-full w-full object-cover scale-[1.12] blur-[8px] brightness-[0.28] saturate-[1.3]"
          />
        </div>
      )}

      {/* overlays */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-transparent to-black/30" aria-hidden />
      {isCurrent && <div className="absolute inset-0 bg-indigo-500/[0.08]" aria-hidden />}

      {/* sequence number */}
      <div className={[
        "absolute left-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-black backdrop-blur-md",
        isCurrent
          ? "border-indigo-400/60 bg-indigo-500/80 text-white shadow-[0_0_10px_rgba(99,102,241,0.55)]"
          : "border-white/[0.16] bg-black/55 text-white/50",
      ].join(" ")}>
        {index + 1}
      </div>

      {/* content row */}
      <div className="relative flex h-full items-center gap-4 px-4 py-3">
        {/* poster thumbnail */}
        <div className="relative ml-4 h-[calc(100%-12px)] shrink-0 overflow-hidden rounded-[0.65rem] shadow-[0_8px_24px_rgba(0,0,0,0.6)]" style={{ aspectRatio: "2/3" }}>
          <TmdbImage
            path={part.posterPath ?? null}
            fallbackPath={null}
            size="w500"
            alt={part.title}
            fallbackLabel={part.title}
            className="h-full w-full object-cover"
          />
        </div>

        {/* text */}
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[14px] font-black leading-[1.25] tracking-[-0.02em] text-white">
            {part.title}
          </h3>
          {part.year && (
            <p className="mt-1 text-[11px] text-white/38">{part.year}</p>
          )}
          {isCurrent && (
            <span className="mt-2 inline-flex items-center rounded-full border border-indigo-400/45 bg-indigo-500/20 px-2 py-[3px] text-[8px] font-black uppercase tracking-[0.18em] text-indigo-200 whitespace-nowrap">
              Você está aqui
            </span>
          )}
        </div>

        {/* action buttons on hover */}
        <div
          className="flex shrink-0 flex-col gap-1.5 opacity-0 transition duration-200 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <CardActionButton
            onClick={watchlist.toggle}
            disabled={watchlist.loading || !watchlist.isLoggedIn}
            title={watchlist.inWatchlist ? "Remover da watchlist" : "Adicionar à watchlist"}
            active={watchlist.inWatchlist} saving={watchlist.saving}
            activeClass="border-sky-400/55 bg-sky-400/[0.18] text-sky-300"
          >
            <IconBookmark filled={watchlist.inWatchlist} />
          </CardActionButton>
          <CardActionButton
            onClick={watched.toggle}
            disabled={watched.loading || !watched.isLoggedIn}
            title={watched.isWatched ? "Desmarcar" : "Já vi"}
            active={watched.isWatched} saving={watched.saving}
            activeClass="border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300"
          >
            <IconCheck />
          </CardActionButton>
          <CardActionButton
            onClick={feedback.toggleNotInterested}
            disabled={feedback.loading || !feedback.isLoggedIn}
            title={feedback.notInterested ? "Remover sem interesse" : "Não tenho interesse"}
            active={feedback.notInterested} saving={feedback.saving}
            activeClass="border-rose-400/55 bg-rose-400/[0.18] text-rose-300"
          >
            <IconX />
          </CardActionButton>
        </div>
      </div>
    </article>
  );

  return href ? (
    <Link href={href} className="block">{inner}</Link>
  ) : (
    <div>{inner}</div>
  );
}

// ─── Poster card (≥ 4 films) ──────────────────────────────────────────────────

function PosterCard({
  part,
  index,
  isCurrent,
}: {
  part: TitleCollectionPart;
  index: number;
  isCurrent: boolean;
}) {
  const releaseYear = part.year != null ? Number(String(part.year).slice(0, 4)) || undefined : undefined;
  const watchlist = useWatchlistToggle({ tmdbId: part.id, mediaType: "movie", title: part.title, releaseYear });
  const watched   = useWatchedToggle({ tmdbId: part.id, mediaType: "movie", title: part.title, releaseYear });
  const feedback  = useUserFeedbackToggle({ tmdbId: part.id, mediaType: "movie", source: "collection" });

  const href = isCurrent ? undefined : `/title/movie/${part.id}`;

  const card = (
    <article className={`group relative ${isCurrent ? "ring-2 ring-indigo-400/50 ring-offset-[3px] ring-offset-[#020617] rounded-[1.2rem]" : ""}`}>
      {/* sequence number */}
      <div className={[
        "absolute -left-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-black backdrop-blur-md",
        isCurrent
          ? "border-indigo-400/60 bg-indigo-500/80 text-white shadow-[0_0_12px_rgba(99,102,241,0.5)]"
          : "border-white/[0.14] bg-black/60 text-white/50",
      ].join(" ")}>
        {index + 1}
      </div>

      {/* poster */}
      <div className="relative overflow-hidden rounded-[1.2rem] border border-white/[0.08] bg-white/[0.035] shadow-[0_14px_40px_rgba(0,0,0,0.32)] transition duration-300 group-hover:-translate-y-1 group-hover:border-indigo-400/30 group-hover:shadow-[0_20px_56px_rgba(0,0,0,0.48)]">
        <div className="relative aspect-[2/3] overflow-hidden bg-white/[0.04]">
          <TmdbImage
            path={part.posterPath ?? null}
            fallbackPath={null}
            size="w500"
            alt={part.title}
            fallbackLabel={part.title}
            className="h-full w-full object-cover brightness-[0.90] saturate-[1.04] transition duration-500 group-hover:scale-[1.045] group-hover:brightness-100"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/[0.08] to-black/[0.18]" aria-hidden />
          <div className="pointer-events-none absolute inset-0 opacity-0 transition duration-500 group-hover:opacity-100 bg-[radial-gradient(circle_at_50%_115%,rgba(99,102,241,0.30),transparent_58%)]" aria-hidden />

          {/* action buttons */}
          <div
            className="absolute inset-x-0 bottom-0 p-2.5 opacity-0 transition duration-300 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex gap-1.5">
              <CardActionButton
                onClick={watchlist.toggle}
                disabled={watchlist.loading || !watchlist.isLoggedIn}
                title={watchlist.inWatchlist ? "Remover da watchlist" : "Adicionar à watchlist"}
                active={watchlist.inWatchlist} saving={watchlist.saving}
                activeClass="border-sky-400/55 bg-sky-400/[0.18] text-sky-300"
              >
                <IconBookmark filled={watchlist.inWatchlist} />
              </CardActionButton>
              <CardActionButton
                onClick={watched.toggle}
                disabled={watched.loading || !watched.isLoggedIn}
                title={watched.isWatched ? "Desmarcar" : "Já vi"}
                active={watched.isWatched} saving={watched.saving}
                activeClass="border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300"
              >
                <IconCheck />
              </CardActionButton>
              <CardActionButton
                onClick={feedback.toggleNotInterested}
                disabled={feedback.loading || !feedback.isLoggedIn}
                title={feedback.notInterested ? "Remover" : "Não tenho interesse"}
                active={feedback.notInterested} saving={feedback.saving}
                activeClass="border-rose-400/55 bg-rose-400/[0.18] text-rose-300"
              >
                <IconX />
              </CardActionButton>
            </div>
          </div>
        </div>
      </div>

      <div className="px-0.5 pt-2.5">
        <p className="line-clamp-2 text-[12px] font-semibold leading-[1.35] tracking-[-0.01em] text-white/88">
          {part.title}
        </p>
        {part.year && (
          <p className="mt-1 text-[11px] text-white/32">{part.year}</p>
        )}
        {isCurrent && (
          <span className="mt-1.5 inline-flex items-center rounded-full border border-indigo-400/45 bg-indigo-500/[0.15] px-2 py-[3px] text-[8px] font-black uppercase tracking-[0.18em] text-indigo-300 whitespace-nowrap">
            Você está aqui
          </span>
        )}
      </div>
    </article>
  );

  return href ? (
    <Link href={href} className="block">{card}</Link>
  ) : (
    <div>{card}</div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

export default function TitleCollectionSection({
  collection,
  currentTitleId,
}: TitleCollectionSectionProps) {
  if (!collection?.parts?.length) return null;

  const count = collection.parts.length;
  const useHorizontal = count <= 3;

  const gridCols = useHorizontal
    ? count === 1 ? "grid-cols-1" : count === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 md:grid-cols-3"
    : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-indigo-500/[0.18] bg-[linear-gradient(135deg,rgba(99,102,241,0.09)_0%,rgba(139,92,246,0.05)_50%,rgba(17,24,39,0.30)_100%)] p-5 shadow-[inset_0_1px_0_rgba(165,180,252,0.08)] backdrop-blur-sm sm:p-6">
      {/* ambient glow */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-indigo-500/[0.10] blur-3xl" aria-hidden />

      {/* header */}
      <div className="relative mb-5 flex items-center gap-3 sm:mb-6">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-400/25 bg-indigo-500/[0.14]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-300">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <rect x="7" y="7" width="10" height="10" rx="1" />
          </svg>
        </div>

        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.28em] text-indigo-300/55">Franquia</p>
          <h2 className="mt-0.5 truncate text-[15px] font-black tracking-[-0.025em] text-white/92">
            {collection.name}
          </h2>
        </div>

        <span className="ml-auto shrink-0 rounded-full border border-indigo-400/20 bg-indigo-500/[0.10] px-2.5 py-1 text-[10px] font-black text-indigo-200/70">
          {count} {count === 1 ? "filme" : "filmes"}
        </span>
      </div>

      {/* cards */}
      <div className={`relative grid gap-3 ${gridCols}`}>
        {collection.parts.map((part, index) =>
          useHorizontal ? (
            <HorizontalCard
              key={part.id}
              part={part}
              index={index}
              isCurrent={part.id === currentTitleId}
            />
          ) : (
            <PosterCard
              key={part.id}
              part={part}
              index={index}
              isCurrent={part.id === currentTitleId}
            />
          )
        )}
      </div>
    </div>
  );
}

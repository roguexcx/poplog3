"use client";

import { CardActionButton } from "@/components/ui/CardActionButton";
import PosterCard from "@/components/ui/PosterCard";
import { IconBookmark, IconCheck, IconX } from "@/components/ui/icons";
import { useUserFeedbackToggle } from "@/hooks/useUserFeedbackToggle";
import { useWatchedToggle } from "@/hooks/useWatchedToggle";
import { useWatchlistToggle } from "@/hooks/useWatchlistToggle";

import type { ReactNode } from "react";

type InteractivePosterCardProps = {
  id: number | string;
  tmdbId?: number | null;
  poplogId?: string | number | null;
  imdbId?: string | null;
  slug?: string | null;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle?: string | null;
  year?: number | string | null;
  posterPath?: string | null;
  fallbackPath?: string | null;
  href?: string;
  accent?: "indigo" | "cyan" | "amber" | "rose";
  topLeft?: ReactNode;
  topRight?: ReactNode;
  footer?: ReactNode;
  className?: string;
  source?: string;
  priority?: boolean;
};

function ActionButtons({
  id,
  tmdbId,
  poplogId,
  imdbId,
  slug,
  mediaType,
  title,
  year,
  source = "card",
}: {
  id: number | string;
  tmdbId?: number | null;
  poplogId?: string | number | null;
  imdbId?: string | null;
  slug?: string | null;
  mediaType: "movie" | "tv";
  title: string;
  year?: number | string | null;
  source?: string;
}) {
  const releaseYear =
    year != null ? Number(String(year).slice(0, 4)) || undefined : undefined;
  const numericId = typeof id === "number" ? id : Number(id);
  const actionTmdbId =
    typeof tmdbId === "number" && Number.isInteger(tmdbId) && tmdbId !== 0
      ? tmdbId
      : Number.isInteger(numericId) && numericId !== 0
        ? numericId
        : 0;
  const hasUsableIdentity =
    actionTmdbId !== 0 || Boolean(poplogId) || Boolean(imdbId) || Boolean(slug);

  const watchlist = useWatchlistToggle({
    tmdbId: actionTmdbId,
    poplogId,
    imdbId,
    slug,
    mediaType,
    title,
    releaseYear,
  });

  const watched = useWatchedToggle({
    tmdbId: actionTmdbId,
    poplogId,
    imdbId,
    slug,
    mediaType,
    title,
    releaseYear,
  });

  const feedback = useUserFeedbackToggle({ tmdbId: actionTmdbId, poplogId, imdbId, slug, mediaType, source });

  return (
    <div
      className="flex gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <CardActionButton
        onClick={watchlist.toggle}
        disabled={!hasUsableIdentity || watchlist.loading || !watchlist.isLoggedIn}
        title={watchlist.inWatchlist ? "Remover da watchlist" : "Adicionar à watchlist"}
        active={watchlist.inWatchlist}
        saving={watchlist.saving}
        activeClass="border-sky-400/55 bg-sky-400/[0.18] text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.25)]"
      >
        <IconBookmark filled={watchlist.inWatchlist} />
      </CardActionButton>

      <CardActionButton
        onClick={watched.toggle}
        disabled={!hasUsableIdentity || watched.loading || !watched.isLoggedIn}
        title={watched.isWatched ? "Desmarcar como assistido" : "Já vi"}
        active={watched.isWatched}
        saving={watched.saving}
        activeClass="border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]"
      >
        <IconCheck />
      </CardActionButton>

      <CardActionButton
        onClick={feedback.toggleNotInterested}
        disabled={!hasUsableIdentity || feedback.loading || !feedback.isLoggedIn}
        title={feedback.notInterested ? "Remover sem interesse" : "Não tenho interesse"}
        active={feedback.notInterested}
        saving={feedback.saving}
        activeClass="border-rose-400/55 bg-rose-400/[0.18] text-rose-300 shadow-[0_0_10px_rgba(251,113,133,0.22)]"
      >
        <IconX />
      </CardActionButton>
    </div>
  );
}

export default function InteractivePosterCard({
  id,
  tmdbId,
  poplogId,
  imdbId,
  slug,
  mediaType,
  title,
  originalTitle,
  year,
  posterPath,
  fallbackPath,
  href,
  accent,
  topLeft,
  topRight,
  footer,
  className,
  source,
  priority = false,
}: InteractivePosterCardProps) {
  return (
    <PosterCard
      posterPath={posterPath}
      fallbackPath={fallbackPath}
      title={title}
      originalTitle={originalTitle}
      year={year}
      mediaType={mediaType}
      href={href}
      accent={accent}
      topLeft={topLeft}
      topRight={topRight}
      footer={footer}
      className={className}
      priority={priority}
      bottomOverlay={
        <ActionButtons
          id={id}
          tmdbId={tmdbId}
          poplogId={poplogId}
          imdbId={imdbId}
          slug={slug}
          mediaType={mediaType}
          title={title}
          year={year}
          source={source}
        />
      }
    />
  );
}

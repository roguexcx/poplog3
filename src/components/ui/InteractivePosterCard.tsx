"use client";

import { useState } from "react";

import { CardActionButton } from "@/components/ui/CardActionButton";
import LibraryStateBadge from "@/components/ui/LibraryStateBadge";
import PosterCard from "@/components/ui/PosterCard";
import { IconBookmark, IconCheck, IconX } from "@/components/ui/icons";
import { useUserAction } from "@/hooks/useUserAction";
import { useUserFeedbackToggle } from "@/hooks/useUserFeedbackToggle";
import { useOptionalUserData } from "@/context/UserDataContext";
import { usePoplogUserState } from "@/stores/user-states-store";

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
  const userData = useOptionalUserData();
  const isLoggedIn = Boolean(userData && !userData.loading);

  const releaseYear =
    year != null ? Number(String(year).slice(0, 4)) || undefined : undefined;
  const numericId = typeof id === "number" ? id : Number(id);
  const actionTmdbId =
    typeof tmdbId === "number" && Number.isInteger(tmdbId) && tmdbId !== 0
      ? tmdbId
      : Number.isInteger(numericId) && numericId !== 0
        ? numericId
        : undefined;
  const poplogIdStr =
    typeof poplogId === "string" ? poplogId :
    typeof poplogId === "number" ? String(poplogId) : undefined;
  const hasUsableIdentity =
    Boolean(actionTmdbId) || Boolean(poplogIdStr) || Boolean(imdbId) || Boolean(slug);

  const { executeAction, effectiveKey } = useUserAction({
    tmdbId: actionTmdbId,
    poplogId: poplogIdStr,
    imdbId: imdbId ?? undefined,
    slug: slug ?? undefined,
    mediaType,
    title,
    releaseYear,
  });

  const zustandState = usePoplogUserState(effectiveKey);
  const inWatchlist = zustandState?.isInWatchlist ?? false;
  const isWatched   = zustandState?.isWatched   ?? false;

  const [saving, setSaving] = useState(false);

  async function handleAction(action: "addToWatchlist" | "removeFromWatchlist" | "markAsWatched" | "markAsUnwatched") {
    setSaving(true);
    await executeAction(action);
    setSaving(false);
  }

  const feedback = useUserFeedbackToggle({
    tmdbId: actionTmdbId ?? 0,
    poplogId: poplogIdStr,
    imdbId: imdbId ?? null,
    slug: slug ?? null,
    mediaType,
    source,
  });

  return (
    <div
      className="flex gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <CardActionButton
        onClick={() => handleAction(inWatchlist ? "removeFromWatchlist" : "addToWatchlist")}
        disabled={!hasUsableIdentity || !isLoggedIn || saving}
        title={inWatchlist ? "Remover da watchlist" : "Adicionar à watchlist"}
        active={inWatchlist}
        saving={saving}
        activeClass="border-sky-400/55 bg-sky-400/[0.18] text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.25)]"
      >
        <IconBookmark filled={inWatchlist} />
      </CardActionButton>

      <CardActionButton
        onClick={() => handleAction(isWatched ? "markAsUnwatched" : "markAsWatched")}
        disabled={!hasUsableIdentity || !isLoggedIn || saving}
        title={isWatched ? "Desmarcar como assistido" : "Já vi"}
        active={isWatched}
        saving={saving}
        activeClass="border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]"
      >
        <IconCheck />
      </CardActionButton>

      <CardActionButton
        onClick={feedback.toggleNotInterested}
        disabled={!hasUsableIdentity || !isLoggedIn || feedback.saving}
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
  const numericTmdbId =
    typeof tmdbId === "number" && Number.isInteger(tmdbId) && tmdbId !== 0
      ? tmdbId
      : typeof id === "number" && Number.isInteger(id) && id !== 0
        ? id
        : undefined;

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
      directOverlay={
        numericTmdbId !== undefined || poplogId ? (
          <LibraryStateBadge
            tmdbId={numericTmdbId}
            poplogId={poplogId}
            imdbId={imdbId}
            mediaType={mediaType}
            className="top-2.5 left-2.5 z-10 group-hover:opacity-0 transition-opacity duration-200"
          />
        ) : undefined
      }
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

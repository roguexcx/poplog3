"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import SynopsisText from "@/features/home/components/SynopsisText";
import { ScrollRowArrows } from "@/components/ScrollRowArrows";
import { CardActionButton } from "@/components/ui/CardActionButton";
import { IconBookmark, IconCheck, IconStar, IconX } from "@/components/ui/icons";
import { useWatchlistToggle } from "@/hooks/useWatchlistToggle";
import { useWatchedToggle } from "@/hooks/useWatchedToggle";
import { useUserFeedbackToggle } from "@/hooks/useUserFeedbackToggle";
import { useScrollRow } from "@/hooks/useScrollRow";
import { useUserData } from "@/context/UserDataContext";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import TmdbImage from "@/components/images/TmdbImage";
import SectionHeader from "@/components/ui/SectionHeader";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ForYouItem = {
  id: number;
  title_label: string;
  original_title_label?: string | null;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  clean_poster_path?: string | null;
  vote_average?: number;
  year?: string | null;
  media_type: "movie" | "tv";
  media_label?: string;
  genre_label?: string | null;
  reason?: string;
  userFeedback?: { notInterested?: boolean };
};

function formatRating(value?: number): string | null {
  return value ? value.toFixed(1) : null;
}

function parseReleaseYear(year?: string | null): number | null {
  if (!year) return null;
  const n = Number(year);
  return Number.isFinite(n) ? n : null;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function ForYouActions({ item }: { item: ForYouItem }) {
  const shared = {
    tmdbId: item.id,
    mediaType: item.media_type,
    title: item.title_label,
    releaseYear: parseReleaseYear(item.year),
  };

  const watchlist = useWatchlistToggle(shared);
  const watched = useWatchedToggle(shared);
  const feedback = useUserFeedbackToggle({
    tmdbId: item.id,
    mediaType: item.media_type,
    source: "for_you",
    initialNotInterested: Boolean(item.userFeedback?.notInterested),
  });

  return (
    <div className="absolute right-2.5 top-2.5 z-40 flex gap-1.5">
      <CardActionButton
        onClick={watchlist.toggle}
        disabled={watchlist.loading || !watchlist.isLoggedIn}
        title={watchlist.inWatchlist ? "Remover da watchlist" : "Adicionar à watchlist"}
        active={watchlist.inWatchlist}
        saving={watchlist.saving}
        activeClass="border-sky-400/55 bg-sky-400/[0.18] text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.25)]"
      >
        <IconBookmark filled={watchlist.inWatchlist} />
      </CardActionButton>

      <CardActionButton
        onClick={watched.toggle}
        disabled={watched.loading || !watched.isLoggedIn}
        title={watched.isWatched ? "Desmarcar como assistido" : "Já vi"}
        active={watched.isWatched}
        saving={watched.saving}
        activeClass="border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]"
      >
        <IconCheck />
      </CardActionButton>

      <CardActionButton
        onClick={feedback.toggleNotInterested}
        disabled={feedback.loading || !feedback.isLoggedIn}
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

// ─── FeaturedCard ─────────────────────────────────────────────────────────────

function FeaturedForYouCard({ item }: { item: ForYouItem }) {
  const backdropPath = item.backdrop_path ?? null;
  const rating = formatRating(item.vote_average);
  const isLongTitle = item.title_label.length > 24;
  const isLongOverview = (item.overview?.length ?? 0) > 140;
  const slug = `/title/${item.media_type}/${item.id}`;

  return (
    <article className="group relative h-[320px] overflow-hidden rounded-[1.65rem] border border-white/10 bg-white/[0.04] shadow-[0_20px_80px_rgba(0,0,0,0.42)] transition duration-300 hover:-translate-y-1 hover:border-sky-300/40 hover:shadow-[0_24px_90px_rgba(56,189,248,0.16)]">
      <Link href={slug} className="absolute inset-0 z-[5]" aria-label={`Abrir ${item.title_label}`} />

      <ForYouActions item={item} />

      {backdropPath && (
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-y-0 -left-[0%] right-50 w-[120%] aspect-video lg:aspect-auto">
            <TmdbImage
              path={backdropPath}
              kind="backdrop"
              size="medium"
              alt={item.title_label}
              fill
              sizes="(max-width: 1024px) 100vw, 65vw"
              className="object-cover object-right"
            />
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#020617] via-[#020617]/80 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,transparent_20%,rgba(2,6,23,0.4)_100%)]" />

      <div
        className={[
          "absolute inset-y-0 left-0 z-20 flex flex-col justify-center p-7",
          isLongTitle || isLongOverview ? "w-[66%]" : "w-[58%]",
        ].join(" ")}
      >
        <div className="mb-3 flex items-center gap-3 text-[11px] font-black uppercase tracking-[0.24em] text-sky-300">
          <span>
            {item.year ? `${item.year} · ` : ""}
            {item.media_label ?? "Título"}
          </span>
          {rating && (
            <span className="flex items-center gap-1 tracking-normal text-amber-400">
              <IconStar />
              {rating}
            </span>
          )}
        </div>

        <LocalizedTitle
          as="h3"
          title={item.title_label}
          originalTitle={item.original_title_label}
          variant="large"
          className="max-w-[360px] drop-shadow-[0_4px_18px_rgba(0,0,0,0.75)] transition group-hover:text-sky-100"
        />

        {item.genre_label && (
          <p className="mt-2 text-[12px] font-semibold text-zinc-300">{item.genre_label}</p>
        )}

        <SynopsisText text={item.overview ?? null} collapsedLines={3} className="mt-3 max-w-[420px]" />

        <p className="mt-3 line-clamp-1 text-[10px] font-bold text-sky-300">
          {item.reason ?? "Combina com você"}
        </p>
      </div>
    </article>
  );
}

// ─── SmallCard ────────────────────────────────────────────────────────────────

function SmallForYouCard({ item }: { item: ForYouItem }) {
  type ImagePick =
    | { kind: "poster"; size: "card"; path: string }
    | { kind: "backdrop"; size: "card"; path: string }
    | null;

  const pick: ImagePick =
    item.clean_poster_path
      ? { kind: "poster", size: "card", path: item.clean_poster_path }
      : item.poster_path
        ? { kind: "poster", size: "card", path: item.poster_path }
        : item.backdrop_path
          ? { kind: "backdrop", size: "card", path: item.backdrop_path }
          : null;

  const rating = formatRating(item.vote_average);

  return (
    <article className="group relative h-[320px] overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.04] shadow-[0_16px_55px_rgba(0,0,0,0.38)] transition duration-300 hover:-translate-y-1 hover:border-sky-300/40 hover:shadow-[0_20px_75px_rgba(56,189,248,0.14)]">
      <Link
        href={`/title/${item.media_type}/${item.id}`}
        className="absolute inset-0 z-10"
        aria-label={`Abrir ${item.title_label}`}
      />

      <ForYouActions item={item} />

      {pick && (
        <TmdbImage
          path={pick.path}
          kind={pick.kind}
          size={pick.size}
          alt={item.title_label}
          fill
          sizes="220px"
          className="object-cover transition duration-700 group-hover:scale-110"
        />
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#020617] via-black/72 via-48% to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/18 via-transparent to-black/15" />
      <div className="pointer-events-none absolute inset-0 opacity-0 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.28)] transition duration-300 group-hover:opacity-100" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4">
        {rating && (
          <div className="mb-2 inline-flex items-center gap-[3px] rounded-full border border-white/[0.14] bg-black/75 px-2 py-[3px] text-[10px] font-semibold text-amber-400 backdrop-blur-[10px]">
            <IconStar />
            {rating}
          </div>
        )}

        <LocalizedTitle
          as="h3"
          title={item.title_label}
          originalTitle={item.original_title_label}
          variant="poster"
          className={[
            "min-h-[2.35rem] line-clamp-2 leading-tight tracking-tight text-white",
            item.title_label.length > 22
              ? "text-[0.9rem] font-extrabold"
              : "text-[1.05rem] font-black",
          ].join(" ")}
        />

        <p className="mt-2 line-clamp-1 text-xs font-semibold text-zinc-300">
          {item.year ? `${item.year} · ` : ""}
          {item.media_label ?? "Título"}
        </p>

        <p className="mt-2 min-h-[1.65rem] line-clamp-2 text-[9px] font-bold leading-snug text-sky-300">
          {item.reason ?? "Combina com você"}
        </p>
      </div>
    </article>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ForYouSkeleton() {
  return (
    <>
      <div className="no-scrollbar -mx-6 flex gap-4 overflow-x-auto px-6 pb-2 lg:hidden">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-[260px] w-[180px] shrink-0 animate-pulse rounded-[1.35rem] bg-white/5" />
        ))}
      </div>
      <div className="hidden gap-5 lg:grid lg:grid-cols-[2.05fr_repeat(4,0.72fr)]">
        <div className="h-[320px] animate-pulse rounded-[1.65rem] bg-white/5" />
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-[320px] animate-pulse rounded-[1.35rem] bg-white/5" />
        ))}
      </div>
    </>
  );
}

// ─── Seção principal ──────────────────────────────────────────────────────────

export default function ForYouSection() {
  const { titles, loading: titlesLoading } = useUserData();
  const [featured, setFeatured] = useState<ForYouItem | null>(null);
  const [items, setItems] = useState<ForYouItem[]>([]);
  const [loading, setLoading] = useState(true);
  const {
    ref: rowRef,
    canScrollLeft,
    canScrollRight,
    scrollLeft: doScrollLeft,
    scrollRight: doScrollRight,
  } = useScrollRow({ step: 392 });

  const didInitRef = useRef(false);
  const [refreshCount, setRefreshCount] = useState(0);

  const fetchForYou = useCallback((titlesSnapshot: typeof titles) => {
    if (titlesSnapshot.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch("/api/user/for-you", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titles: titlesSnapshot }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json) {
          setFeatured(json.featured ?? null);
          setItems(json.items ?? []);
        }
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (titlesLoading) return;
    if (didInitRef.current && refreshCount === 0) return;
    didInitRef.current = true;
    fetchForYou(titles);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titlesLoading, refreshCount]);

  function handleRefresh() {
    if (loading) return;
    setRefreshCount((c) => c + 1);
  }

  if (!loading && !featured && items.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title="Para você"
        subtitle="Escolhas personalizadas com base no que você ama."
        className="mb-6"
        action={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              onClick={handleRefresh}
              disabled={loading}
              className={[
                "flex items-center gap-2 rounded-full border px-4 py-1.5 backdrop-blur-[8px]",
                "text-[10px] font-semibold uppercase tracking-[0.08em]",
                "transition-[transform,background,border-color] duration-200 hover:scale-105",
                "border-white/[0.18] bg-black/[0.72] text-white/60",
                "hover:border-sky-500/40 hover:text-white/85",
                "disabled:pointer-events-none disabled:opacity-30",
              ].join(" ")}
              aria-label="Atualizar recomendações"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <path d="M1 4v6h6M23 20v-6h-6" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
              Novos títulos
            </button>
            <Link
              href="/profile?tab=recommendations"
              className="hidden text-xs font-bold text-sky-300 transition hover:text-white md:block"
            >
              Ver todos →
            </Link>
            <div className="flex lg:hidden">
              <ScrollRowArrows
                canScrollLeft={canScrollLeft}
                canScrollRight={canScrollRight}
                onLeft={doScrollLeft}
                onRight={doScrollRight}
              />
            </div>
          </div>
        }
      />

      {loading ? (
        <ForYouSkeleton />
      ) : (
        <>
          <div ref={rowRef} className="no-scrollbar -mx-6 flex gap-4 overflow-x-auto px-6 pb-2 lg:hidden">
            {featured && (
              <div className="w-[180px] shrink-0">
                <SmallForYouCard item={featured} />
              </div>
            )}
            {items.map((item) => (
              <div key={`${item.media_type}-${item.id}`} className="w-[180px] shrink-0">
                <SmallForYouCard item={item} />
              </div>
            ))}
          </div>

          <div className="hidden gap-5 lg:grid lg:grid-cols-[2.05fr_repeat(4,0.72fr)]">
            {featured && <FeaturedForYouCard item={featured} />}
            {items.map((item) => (
              <SmallForYouCard key={`${item.media_type}-${item.id}`} item={item} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

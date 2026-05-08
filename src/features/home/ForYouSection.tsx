// src/features/home/ForYouSection.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import SynopsisText from "@/features/home/components/SynopsisText";
import { useWatchlistToggle } from "@/hooks/useWatchlistToggle";
import { useWatchedToggle } from "@/hooks/useWatchedToggle";
import { createClient } from "@/lib/supabase/client";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ForYouItem = {
  id: number;
  title_label: string;
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

// ─── Utilitários ──────────────────────────────────────────────────────────────

function getImageUrl(path?: string | null, size = "w780"): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function formatRating(value?: number): string | null {
  return value ? value.toFixed(1) : null;
}

function parseReleaseYear(year?: string | null): number | null {
  if (!year) return null;

  const n = Number(year);

  return Number.isFinite(n) ? n : null;
}

// ─── ForYouActions ────────────────────────────────────────────────────────────

function ForYouActions({ item }: { item: ForYouItem }) {
  const shared = {
    tmdbId: item.id,
    mediaType: item.media_type,
    title: item.title_label,
    releaseYear: parseReleaseYear(item.year),
  };

  const watchlist = useWatchlistToggle(shared);
  const watched = useWatchedToggle(shared);

  const btnBase =
    "grid h-[30px] w-[30px] place-items-center rounded-full border backdrop-blur-[10px] transition-[transform,background,border-color,box-shadow] duration-200 hover:scale-110 disabled:opacity-50";

  return (
    <div className="absolute right-2.5 top-2.5 z-40 flex gap-1.5">
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          watchlist.toggle();
        }}
        disabled={watchlist.loading || watchlist.saving || !watchlist.isLoggedIn}
        title={
          watchlist.inWatchlist
            ? "Remover da watchlist"
            : "Adicionar à watchlist"
        }
        className={[
          btnBase,
          watchlist.inWatchlist
            ? "border-sky-400/55 bg-sky-400/[0.18] text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.25)]"
            : "border-white/[0.18] bg-black/[0.72] text-white/85 hover:border-violet-500/60 hover:shadow-[0_0_12px_rgba(139,92,246,0.3)]",
        ].join(" ")}
      >
        {watchlist.saving ? (
          <span className="text-[10px]">…</span>
        ) : (
          <IconBookmark filled={watchlist.inWatchlist} />
        )}
      </button>

      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          watched.toggle();
        }}
        disabled={watched.loading || watched.saving || !watched.isLoggedIn}
        title={watched.isWatched ? "Desmarcar como assistido" : "Já vi"}
        className={[
          btnBase,
          watched.isWatched
            ? "border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]"
            : "border-white/[0.18] bg-black/[0.72] text-white/85 hover:border-emerald-500/60 hover:text-emerald-300 hover:shadow-[0_0_12px_rgba(52,211,153,0.3)]",
        ].join(" ")}
      >
        {watched.saving ? <span className="text-[10px]">…</span> : <IconCheck />}
      </button>
    </div>
  );
}

// ─── FeaturedCard, card grande ────────────────────────────────────────────────

function FeaturedForYouCard({ item }: { item: ForYouItem }) {
  const router = useRouter();

  const backdropUrl = getImageUrl(item.backdrop_path, "w1280");
  const rating = formatRating(item.vote_average);

  const isLongTitle = item.title_label.length > 24;
  const isLongOverview = (item.overview?.length ?? 0) > 140;

  function openTitlePage() {
    router.push(`/title/${item.media_type}/${item.id}`);
  }

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={openTitlePage}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          openTitlePage();
        }
      }}
      className="group relative h-[320px] cursor-pointer overflow-hidden rounded-[1.65rem] border border-white/10 bg-white/[0.04] shadow-[0_20px_80px_rgba(0,0,0,0.42)] transition duration-300 hover:-translate-y-1 hover:border-sky-300/40 hover:shadow-[0_24px_90px_rgba(56,189,248,0.16)]"
    >
      <ForYouActions item={item} />

      {backdropUrl && (
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-y-0 -left-[0%] right-50 w-[120%] aspect-video lg:aspect-auto">
            <Image
              src={backdropUrl}
              alt={item.title_label}
              fill
              sizes="100vw"
              className="object-cover object-right"
              priority
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

        <h3
          className={[
            "line-clamp-2 max-w-[360px] tracking-tight text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.75)] transition group-hover:text-sky-100",
            isLongTitle
              ? "text-[1.45rem] font-black leading-[1]"
              : "text-[1.75rem] font-black leading-[1.04]",
          ].join(" ")}
        >
          {item.title_label}
        </h3>

        {item.genre_label && (
          <p className="mt-2 text-[12px] font-semibold text-zinc-300">
            {item.genre_label}
          </p>
        )}

        <SynopsisText
          text={item.overview ?? null}
          collapsedLines={3}
          className="mt-3 max-w-[420px]"
        />

        <p className="mt-3 line-clamp-1 text-[10px] font-bold text-sky-300">
          {item.reason ?? "Combina com você"}
        </p>
      </div>
    </article>
  );
}

// ─── SmallCard ────────────────────────────────────────────────────────────────

function SmallForYouCard({ item }: { item: ForYouItem }) {
  const image =
    getImageUrl(item.clean_poster_path, "original") ??
    getImageUrl(item.poster_path, "original") ??
    getImageUrl(item.backdrop_path, "w1280");

  const rating = formatRating(item.vote_average);

  return (
    <article className="group relative h-[320px] overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.04] shadow-[0_16px_55px_rgba(0,0,0,0.38)] transition duration-300 hover:-translate-y-1 hover:border-sky-300/40 hover:shadow-[0_20px_75px_rgba(56,189,248,0.14)]">
      <Link
        href={`/title/${item.media_type}/${item.id}`}
        className="absolute inset-0 z-10"
        aria-label={`Abrir ${item.title_label}`}
      />

      <ForYouActions item={item} />

      {image && (
        <Image
          src={image}
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

        <h3
          className={[
            "min-h-[2.35rem] line-clamp-2 leading-tight tracking-tight text-white",
            item.title_label.length > 22
              ? "text-[0.9rem] font-extrabold"
              : "text-[1.05rem] font-black",
          ].join(" ")}
          title={item.title_label}
        >
          {item.title_label}
        </h3>

        <p className="mt-2 line-clamp-1 text-xs font-semibold text-zinc-300">
          {item.year ? `${item.year} · ` : ""}
          {item.media_label ?? "Título"}
        </p>

        <p
          className="mt-2 min-h-[1.65rem] line-clamp-2 text-[9px] font-bold leading-snug text-sky-300"
          title={item.reason ?? "Combina com você"}
        >
          {item.reason ?? "Combina com você"}
        </p>
      </div>
    </article>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function ForYouSkeleton() {
  return (
    <>
      <div className="-mx-6 flex gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:hidden">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-[260px] w-[180px] shrink-0 animate-pulse rounded-[1.35rem] bg-white/5"
          />
        ))}
      </div>

      <div className="hidden gap-5 lg:grid lg:grid-cols-[2.05fr_repeat(4,0.72fr)]">
        <div className="h-[320px] animate-pulse rounded-[1.65rem] bg-white/5" />
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-[320px] animate-pulse rounded-[1.35rem] bg-white/5"
          />
        ))}
      </div>
    </>
  );
}

// ─── Seção principal ──────────────────────────────────────────────────────────

export default function ForYouSection() {
  const [featured, setFeatured] = useState<ForYouItem | null>(null);
  const [items, setItems] = useState<ForYouItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
  async function load() {
    const supabase = createClient();

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setLoading(false);
      return;
    }

    const { data: rawTitles, error } = await supabase
      .from("user_titles")
      .select("*")
      .eq("user_id", session.user.id);

    if (error) {
      console.error("Erro ao carregar títulos para recomendações:", error);
      setLoading(false);
      return;
    }

    if (!rawTitles?.length) {
      setLoading(false);
      return;
    }

      const res = await fetch("/api/user/for-you", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titles: rawTitles }),
      });

      if (!res.ok) {
        setLoading(false);
        return;
      }

      const json = await res.json();

      setFeatured(json.featured ?? null);
      setItems(json.items ?? []);
      setLoading(false);
    }

    load();
  }, []);

  if (!loading && !featured && items.length === 0) return null;

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-white">
            Para você
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Escolhas personalizadas com base no que você ama.
          </p>
        </div>

        <Link
          href="/profile?tab=recommendations"
          className="hidden text-xs font-bold text-sky-300 transition hover:text-white md:block"
        >
          Ver todos →
        </Link>
      </div>

      {loading ? (
        <ForYouSkeleton />
      ) : (
        <>
          <div className="-mx-6 flex gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:hidden">
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
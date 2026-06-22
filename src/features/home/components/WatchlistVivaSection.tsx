"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CatalogImage from "@/components/images/CatalogImage";
import { ScrollRowArrows } from "@/components/ScrollRowArrows";
import { useUserData } from "@/context/UserDataContext";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import { CardActionButton } from "@/components/ui/CardActionButton";
import { notifyUserTitlesUpdated } from "@/hooks/useTitleToggle";
import { IconCheck } from "@/components/ui/icons";
import { useScrollRow } from "@/hooks/useScrollRow";
import SectionHeader from "@/components/ui/SectionHeader";

// ─── Types ────────────────────────────────────────────────────────────────────

type StreamStatus = "streaming" | "chegando" | "cinemas" | "confirmado" | "unavailable";
type WatchlistRow = {
  id: string;
  poplogId?: string | number | null;
  tmdb_id: number;
  media_type: "movie" | "tv";
  externalIds?: WatchlistIdentityFields["externalIds"];
  imdb_id?: string | null;
  slug?: string | null;
  title: string | null;
  release_year: number | null;
  created_at: string;
  fridge?: boolean | null;
  stream_status?: string | null;
  stream_status_checked_at?: string | null;
};
type WatchlistSlot = "recent" | "old" | "free" | "fridge";

interface WatchlistTitle {
  id: string;
  poplogId?: string | number | null;
  tmdb_id: number;
  media_type: "movie" | "tv";
  externalIds?: WatchlistIdentityFields["externalIds"];
  identityUsed?: string;
  linkIdUsed?: string | number;
  title: string;
  original_title_label?: string | null;
  poster_path: string | null;
  year: string | null;
  genre: string | null;
  runtime: number | null;
  runtime_label: string | null;
  seasons: number | null;
  origin: "cinema" | "streaming";
  release_date: string;
  created_at: string;
  stream_status: StreamStatus;
  providers: { name: string; logo: string; type: "flatrate" | "rent" | "buy" }[];
  estimated_platform: string | null;
  estimated_month: string | null;
  context_pool: string[];
  fridge: boolean;
  stream_status_updated?: boolean;
}

type WatchlistIdentityFields = {
  externalIds?: {
    tmdbId?: number;
    imdbId?: string;
    tvdbId?: string;
    traktId?: string | number;
    balloonerismmId?: string;
    slug?: string;
  };
};

// ─── Selection logic ──────────────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

function selectFive(all: WatchlistTitle[]): Array<WatchlistTitle & { _slot: WatchlistSlot }> {
  // Excluir títulos ainda não disponíveis (não lançados / apenas em cartaz)
  // do pool principal de seleção — eles não devem aparecer como recomendações de watchlist
  const available = all.filter(
    (t) => t.stream_status !== "cinemas" && t.stream_status !== "chegando"
  );
  const allPool  = available.length >= 3 ? available : all; // fallback se poucos disponíveis
  const main   = allPool.filter((t) => !t.fridge);
  const fridge = allPool.filter((t) => t.fridge);
  const recent = main.filter((t) => daysSince(t.created_at) <= 45);
  const old    = main.filter((t) => daysSince(t.created_at) > 90);
  const middle = main.filter((t) => !recent.includes(t) && !old.includes(t));

  const picked: Array<WatchlistTitle & { _slot: WatchlistSlot }> = [];
  const usedIds = new Set<string>();

  function addFrom(pool: WatchlistTitle[], slot: WatchlistSlot): boolean {
    const avail = pool.filter((t) => !usedIds.has(t.id));
    if (!avail.length) return false;
    const t = pickRandom(avail);
    picked.push({ ...t, _slot: slot });
    usedIds.add(t.id);
    return true;
  }

  if (!addFrom(recent, "recent")) addFrom(middle, "free");
  if (!addFrom(old, "old"))       addFrom(middle, "free");

  const fillPool = shuffle([...recent, ...old, ...middle]);
  while (picked.length < 5) {
    const tryFridge = fridge.length > 0 && Math.random() < 0.1;
    if (tryFridge) {
      if (!addFrom(fridge, "fridge")) addFrom(fillPool, "free");
    } else {
      if (!addFrom(fillPool, "free")) addFrom(fridge, "fridge");
    }
    if (picked.length >= all.length) break;
  }

  return shuffle(picked);
}

// ─── Badge config ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<StreamStatus, { label: string; border: string; bg: string; text: string }> = {
  confirmado: {
    label: "Disponível",
    border: "border-emerald-400/40",
    bg:     "bg-emerald-500/[0.18]",
    text:   "text-emerald-300",
  },
  streaming: {
    label: "Disponível",
    border: "border-zinc-400/30",
    bg:     "bg-zinc-500/[0.12]",
    text:   "text-zinc-400",
  },
  chegando: {
    label: "Chegando",
    border: "border-amber-400/40",
    bg:     "bg-amber-500/[0.18]",
    text:   "text-amber-300",
  },
  cinemas: {
    label: "Nos cinemas",
    border: "border-rose-400/40",
    bg:     "bg-rose-500/[0.18]",
    text:   "text-rose-300",
  },
  unavailable: {
    label: "Indisponível no BR",
    border: "border-zinc-500/40",
    bg:     "bg-zinc-500/[0.14]",
    text:   "text-zinc-400",
  },
};

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" className="h-[13px] w-[13px]" fill="none"
      stroke="currentColor" strokeWidth={2}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function WatchlistCard({
  item,
  onDismiss,
}: {
  item: WatchlistTitle & { _slot: WatchlistSlot };
  onDismiss: (item: WatchlistTitle, action: "watched" | "remove") => void;
}) {
  const [imgErr, setImgErr]         = useState(false);
  const [dismissed, setDismissed]   = useState(false);
  const [watchedActive, setWatched] = useState(false);

  const slug        = `/title/${item.media_type}/${item.poplogId ?? item.tmdb_id}`;
  const posterPath  = item.poster_path ?? null;

  const flatrateProvider = item.providers.find((p) => p.type === "flatrate") ?? null;
  const rentProvider     = item.providers.find((p) => p.type === "rent")     ?? null;
  const buyProvider      = item.providers.find((p) => p.type === "buy")      ?? null;
  const mainProvider     = flatrateProvider ?? rentProvider ?? buyProvider ?? null;
  const providerTypeLabel = flatrateProvider ? null : rentProvider ? "Alugar" : buyProvider ? "Comprar" : null;
  const badge        = STATUS_BADGE[item.stream_status];
  // Sem provider, só exibimos estados temporais confiáveis — evita o falso "Indisponível no BR".
  const showTemporalBadge = item.stream_status === "cinemas" || item.stream_status === "chegando";
  const isMovie      = item.media_type === "movie";
  const THIS_YEAR    = String(new Date().getFullYear());
  const showYear     = item.year && item.year !== THIS_YEAR;

  function dismiss(action: "watched" | "remove") {
    if (action === "watched") setWatched(true);
    setDismissed(true);
    setTimeout(() => onDismiss(item, action), 280);
  }

  return (
    <article
      className={[
        "group relative w-full transition-[opacity,transform] duration-300",
        dismissed ? "pointer-events-none scale-95 opacity-0" : "opacity-100 scale-100",
      ].join(" ")}
    >
      <div className="relative">
        <Link href={slug} className="block">
          <div
            className={[
              "relative aspect-[2/3] w-full overflow-hidden rounded-[14px] bg-[#0e0e1a]",
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
            {posterPath && !imgErr ? (
              <CatalogImage
                src={posterPath}
                size="w342"
                alt={item.title}
                fill
                sizes="(max-width: 768px) 160px, 220px"
                className="object-cover brightness-[0.92] saturate-[1.05] transition-[transform,filter] duration-[600ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)] group-hover:scale-[1.04] group-hover:brightness-100 group-hover:saturate-110"
                onError={() => setImgErr(true)}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-[#0e0e1a] text-[11px] text-[#3a3a55]">
                Sem imagem
              </div>
            )}

            <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-t from-black/70 via-transparent to-black/25" />
            <div className="pointer-events-none absolute inset-0 z-[3] bg-[radial-gradient(ellipse_at_50%_110%,rgba(99,102,241,0.22),transparent_65%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

            {mainProvider ? (
              <div className="absolute bottom-2.5 left-2.5 z-20 flex items-center gap-1.5 rounded-[5px] border border-white/[0.18] bg-black/[0.72] px-[7px] py-[3px] backdrop-blur-[8px]">
                <CatalogImage
                  src={mainProvider.logo}
                  size="w45"
                  alt={mainProvider.name}
                  width={13}
                  height={13}
                  className="rounded-[3px]"
                />
                <span className="text-[9px] font-semibold text-white/80">
                  {providerTypeLabel ? `${providerTypeLabel} · ${mainProvider.name}` : mainProvider.name}
                </span>
              </div>
            ) : showTemporalBadge ? (
              // Sem provider: só exibimos estados TEMPORAIS confiáveis (Nos cinemas / Chegando).
              // NUNCA o falso "Indisponível no BR" — a cobertura BR da fonte é incompleta e
              // ausência de provider ≠ indisponível. Idem para o "Disponível" sem logo.
              <div className={[
                "absolute bottom-2.5 left-2.5 z-20 rounded-[5px] border px-[7px] py-[2px]",
                "text-[9px] font-bold uppercase tracking-[0.08em] backdrop-blur-[8px]",
                badge.border, badge.bg, badge.text,
              ].join(" ")}>
                {badge.label}
              </div>
            ) : null}

            {(item._slot === "recent" || item._slot === "old") && (
              <div className="absolute right-2.5 top-2.5 z-20 rounded-full border border-white/[0.18] bg-black/[0.82] px-2 py-[3px] backdrop-blur-[10px]">
                <span className="text-[8px] font-semibold uppercase tracking-[0.06em] text-white/40">
                  {item._slot === "recent" ? "recente" : "antigo"}
                </span>
              </div>
            )}
          </div>
        </Link>

        <div className="absolute left-2.5 top-2.5 z-30 flex flex-col gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <CardActionButton
            onClick={() => dismiss("watched")}
            disabled={false}
            title="Marcar como assistido"
            active={watchedActive}
            saving={false}
            activeClass="border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]"
          >
            <IconCheck />
          </CardActionButton>
          <CardActionButton
            onClick={() => dismiss("remove")}
            disabled={false}
            title="Remover da watchlist"
            active={false}
            saving={false}
            activeClass=""
          >
            <IconTrash />
          </CardActionButton>
        </div>
      </div>

      <Link href={slug} className="mt-2.5 block px-0.5">
        <LocalizedTitle
          as="h3"
          title={item.title}
          originalTitle={item.original_title_label}
          variant="poster"
          className="line-clamp-2 text-[13px] font-[500] leading-[1.35] tracking-[-0.01em] text-[#e8e8f0] transition-colors duration-200 group-hover:text-[#f4f4fa]"
        />

        <p className="mt-1 flex flex-wrap items-center gap-[5px] text-[11px] text-[#52526a] truncate">
          {showYear && <span>{item.year}</span>}
          {showYear && <span className="inline-block h-[2px] w-[2px] shrink-0 rounded-full bg-[#3a3a50]" />}
          <span>{isMovie ? "Filme" : item.seasons ? `T${item.seasons} · Série` : "Série"}</span>
          {item.runtime_label && (
            <>
              <span className="inline-block h-[2px] w-[2px] shrink-0 rounded-full bg-[#3a3a50]" />
              <span>{item.runtime_label}</span>
            </>
          )}
        </p>

      </Link>
    </article>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="w-full animate-pulse">
      <div className="aspect-[2/3] w-full rounded-[14px] bg-white/[0.06] ring-1 ring-white/[0.08]" />
      <div className="mt-2.5 h-3 w-3/4 rounded bg-white/[0.06]" />
      <div className="mt-1.5 h-2.5 w-1/2 rounded bg-white/[0.04]" />
      <div className="mt-1.5 h-2.5 w-full rounded bg-white/[0.03]" />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function WatchlistVivaSection() {
  const { titles: userTitles, loading: titlesLoading } = useUserData();
  const [allTitles, setAllTitles] = useState<WatchlistTitle[]>([]);
  const [visible, setVisible]     = useState<Array<WatchlistTitle & { _slot: WatchlistSlot }>>([]);
  const [loading, setLoading]     = useState(true);
  const {
    ref: rowRef,
    canScrollLeft,
    canScrollRight,
    scrollLeft: doScrollLeft,
    scrollRight: doScrollRight,
  } = useScrollRow({ step: 352 });

  const lastKeyRef = useRef<string>("");

  useEffect(() => {
    if (titlesLoading) return;

    const rows = userTitles.filter((t) => t.status === "watchlist") as WatchlistRow[];
    const key  = rows.map((r) => r.id).sort().join(",");

    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    if (!rows.length) {
      setAllTitles([]);
      setVisible([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    async function load() {
      try {
        const res = await fetch("/api/watchlist/live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ titles: rows }),
        });
        if (!res.ok) return;

        const json = await res.json();
        const enriched: WatchlistTitle[] = json.titles ?? [];

        setAllTitles(enriched);
        setVisible(selectFive(enriched));
      } catch {
        // silent failure — section simply does not render
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [titlesLoading, userTitles]);

  function reshuffle() {
    setVisible(selectFive(allTitles));
  }

  function handleDismiss(item: WatchlistTitle, action: "watched" | "remove") {
    const { id } = item;
    const next = allTitles.filter((t) => t.id !== id);
    setAllTitles(next);
    setVisible((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      const usedIds  = new Set(filtered.map((t) => t.id));
      const spare    = next.find((t) => !usedIds.has(t.id));
      if (spare) return [...filtered, { ...spare, _slot: "free" as WatchlistSlot }];
      return filtered;
    });

    const notifyUpdate = () => notifyUserTitlesUpdated();

    if (action === "watched") {
      fetch("/api/library/title", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          poplogId: item.poplogId,
          tmdbId: item.tmdb_id,
          imdbId: item.externalIds?.imdbId,
          slug: item.externalIds?.slug,
          mediaType: item.media_type,
          title: item.title,
          releaseYear: item.year ? Number(item.year) : undefined,
          status: "watched",
        }),
      }).then(notifyUpdate);
    } else {
      fetch("/api/library/title", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          poplogId: item.poplogId,
          tmdbId: item.tmdb_id,
          imdbId: item.externalIds?.imdbId,
          slug: item.externalIds?.slug,
          mediaType: item.media_type,
        }),
      }).then(notifyUpdate);
    }
  }

  if (!loading && allTitles.length === 0) return null;

  return (
    <section>
      <SectionHeader
        title="Da sua watchlist"
        className="mb-6"
        action={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              onClick={reshuffle}
              disabled={loading || allTitles.length <= 5}
              className={[
                "flex items-center gap-2 rounded-full border px-4 py-1.5 backdrop-blur-[8px]",
                "text-[10px] font-semibold uppercase tracking-[0.08em]",
                "transition-[transform,background,border-color,box-shadow] duration-200 hover:scale-105",
                "border-white/[0.18] bg-black/[0.72] text-white/60",
                "hover:border-violet-500/40 hover:text-white/85",
                "disabled:pointer-events-none disabled:opacity-30",
              ].join(" ")}
              aria-label="Sortear outros títulos"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth={2.2}>
                <path d="M1 4v6h6M23 20v-6h-6" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
              Sortear outros
            </button>
            <div className="flex md:hidden">
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

      <div
        ref={rowRef}
        className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0 md:pb-0"
      >
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="w-[160px] shrink-0 md:w-auto">
                <SkeletonCard />
              </div>
            ))
          : visible.map((item) => (
              <div key={item.id} className="w-[160px] shrink-0 md:w-auto">
                <WatchlistCard item={item} onDismiss={handleDismiss} />
              </div>
            ))}
      </div>
    </section>
  );
}

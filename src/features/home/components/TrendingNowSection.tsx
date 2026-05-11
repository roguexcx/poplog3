// src/features/home/components/TrendingNowSection.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import TmdbImage from "@/components/images/TmdbImage";
import { ScrollRowArrows } from "@/components/ScrollRowArrows";
import { CardActionButton } from "@/components/ui/CardActionButton";
import { IconBookmark, IconCheck } from "@/components/ui/icons";
import { useScrollRow } from "@/hooks/useScrollRow";
import { useWatchlistToggle } from "@/hooks/useWatchlistToggle";
import { useWatchedToggle } from "@/hooks/useWatchedToggle";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import SectionHeader from "@/components/layout/SectionHeader";

// ─── Types ────────────────────────────────────────────────────────────────────

type MediaFilter = "all" | "movie" | "tv";

interface TrendingItem {
  id: number;
  media_type: "movie" | "tv";
  title_label: string;
  original_title_label: string | null;
  poster_path: string | null;
  year: string | null;
  media_label: string;
  season_label: string | null;
  is_new: boolean;
  new_label: string | null;
}

// ─── API ─────────────────────────────────────────────────────────────────────

interface RawTMDBItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  media_type: "movie" | "tv";
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  last_air_date?: string | null;
  number_of_seasons?: number | null;
}

const DAYS_NEW = 90;

function daysSince(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function toTrendingItem(raw: RawTMDBItem): TrendingItem {
  const isMovie = raw.media_type === "movie";
  const year = isMovie
    ? (raw.release_date ?? "").slice(0, 4) || null
    : (raw.last_air_date ?? raw.first_air_date ?? "").slice(0, 4) || null;

  const season_label =
    !isMovie && raw.number_of_seasons
      ? `T${raw.number_of_seasons} · Série`
      : !isMovie ? "Série" : null;

  let is_new = false;
  let new_label: string | null = null;

  if (isMovie) {
    const age = daysSince(raw.release_date);
    if (age !== null && age <= DAYS_NEW) { is_new = true; new_label = "Estreia"; }
  } else {
    const seasons = raw.number_of_seasons ?? 1;
    const refDate = seasons === 1 ? raw.first_air_date : raw.last_air_date;
    const age = daysSince(refDate);
    if (age !== null && age <= DAYS_NEW) {
      is_new = true;
      new_label = seasons === 1 ? "Nova Série" : "Temporada Nova";
    }
  }

  return {
    id: raw.id,
    media_type: raw.media_type,
    title_label: raw.title ?? raw.name ?? "Sem título",
    original_title_label: raw.original_title ?? raw.original_name ?? null,
    poster_path: raw.poster_path,
    year,
    media_label: isMovie ? "Filme" : "Série",
    season_label,
    is_new,
    new_label,
  };
}

async function fetchTrending(): Promise<TrendingItem[]> {
  const res = await fetch("/api/tmdb/list?type=trending");
  if (!res.ok) return [];
  const json = await res.json();
  return (json.results ?? []).map(toTrendingItem);
}

// ─── Filter pills ─────────────────────────────────────────────────────────────

const FILTERS: { value: MediaFilter; label: string }[] = [
  { value: "all",   label: "Todos"  },
  { value: "movie", label: "Filmes" },
  { value: "tv",    label: "Séries" },
];

function FilterPills({ active, onChange }: { active: MediaFilter; onChange: (v: MediaFilter) => void }) {
  return (
    <div className="flex items-center gap-2">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          onClick={() => onChange(f.value)}
          className={[
            "rounded-full px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] backdrop-blur-[8px]",
            "transition-[transform,background,border-color,box-shadow] duration-200 hover:scale-105",
            active === f.value
              ? "border border-violet-500/55 bg-violet-500/[0.18] text-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.3)]"
              : "border border-white/[0.18] bg-black/[0.72] text-white/60 hover:border-violet-500/40 hover:text-white/85",
          ].join(" ")}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="shrink-0 w-[160px] md:w-[180px] animate-pulse">
      <div className="aspect-[2/3] w-full rounded-[14px] bg-white/[0.06] ring-1 ring-white/[0.08]" />
      <div className="mt-2.5 h-3 w-3/4 rounded bg-white/[0.06]" />
      <div className="mt-1.5 h-2.5 w-1/2 rounded bg-white/[0.04]" />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const THIS_YEAR = String(new Date().getFullYear());

function MetaLine({ item }: { item: TrendingItem }) {
  const showYear = item.year && item.year !== THIS_YEAR;
  const label = item.season_label ?? item.media_label;
  return (
    <p className="mt-1 flex items-center gap-[5px] text-[11px] text-[#52526a] truncate">
      {showYear && <span>{item.year}</span>}
      {showYear && <span className="inline-block h-[2px] w-[2px] shrink-0 rounded-full bg-[#3a3a50]" />}
      <span className="truncate">{label}</span>
    </p>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
//
// Estrutura do card — sem <Link> global envolvendo tudo.
// O poster tem seu próprio <Link>.
// O texto embaixo tem seu próprio <Link>.
// Os botões ficam FORA de qualquer <Link>, sem stopPropagation necessário.

function TrendingCard({ item, rank }: { item: TrendingItem; rank: number }) {
  // TmdbImage já trata erro de runtime via onError + fallback,
  // mas mantemos o state local para esconder o card e exibir
  // o placeholder cinza com texto quando o path é nulo.
  const [imgErr, setImgErr] = useState(false);
  const posterPath = item.poster_path;
  const isMovie = item.media_type === "movie";
  const slug = `/title/${item.media_type}/${item.id}`;

  const sharedProps = {
    tmdbId: item.id,
    mediaType: item.media_type as "movie" | "tv",
    title: item.title_label,
    releaseYear: item.year ? Number(item.year) : null,
  };
  const watchlist = useWatchlistToggle(sharedProps);
  const watched   = useWatchedToggle(sharedProps);

  return (
    <article className="group relative shrink-0 w-[160px] md:w-[180px]">

      {/* ── Poster (link independente) ── */}
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
              <TmdbImage
                path={posterPath}
                kind="poster"
                size="card"
                alt={item.title_label}
                fill
                sizes="(max-width: 768px) 160px, 180px"
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

            {/* Badge inferior esquerdo: novidade se existir, senão tipo */}
            {item.is_new && item.new_label ? (
              <div className="absolute bottom-2.5 left-2.5 z-20 rounded-[5px] border border-sky-400/40 bg-sky-500/[0.18] px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.08em] text-sky-300 backdrop-blur-[8px]">
                {item.new_label}
              </div>
            ) : (
              <div className="absolute bottom-2.5 left-2.5 z-20 rounded-[5px] border border-violet-500/40 bg-violet-500/[0.18] px-[7px] py-[2px] text-[9px] font-semibold uppercase tracking-[0.08em] text-violet-300 backdrop-blur-[8px]">
                {isMovie ? "Filme" : "Série"}
              </div>
            )}

            {/* Badge superior direito: rank sempre */}
            <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1 rounded-full border border-white/[0.18] bg-black/[0.82] px-2 py-[3px] backdrop-blur-[10px]">
              <span className="text-[8px] font-black text-violet-400/80 leading-none">#</span>
              <span className="text-[12px] font-black leading-none tracking-tight text-white tabular-nums">{rank}</span>
            </div>

            {/* Play hint */}
            <div className="absolute inset-0 z-20 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.18] bg-black/[0.72] backdrop-blur-[10px]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </div>
        </Link>

        {/*
          Botões de ação — FORA do <Link>, sobrepostos via absolute.
          Ficam invisíveis até hover. Não há stopPropagation necessário
          porque não há <Link> envolvendo eles.
        */}
        <div className="absolute left-2.5 top-2.5 z-30 flex flex-col gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <CardActionButton
            onClick={watchlist.toggle}
            disabled={watchlist.loading || !watchlist.isLoggedIn}
            title={watchlist.inWatchlist ? "Remover da watchlist" : "Adicionar à watchlist"}
            active={watchlist.inWatchlist} saving={watchlist.saving}
            activeClass="border-sky-400/55 bg-sky-400/[0.18] text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.25)]"
          >
            <IconBookmark filled={watchlist.inWatchlist} />
          </CardActionButton>
          <CardActionButton
            onClick={watched.toggle}
            disabled={watched.loading || !watched.isLoggedIn}
            title={watched.isWatched ? "Desmarcar como assistido" : "Já vi"}
            active={watched.isWatched} saving={watched.saving}
            activeClass="border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]"
          >
            <IconCheck />
          </CardActionButton>
        </div>
      </div>

      {/* ── Texto (link independente) ── */}
      <Link href={slug} className="mt-2.5 block px-0.5">
        <LocalizedTitle
          as="h3"
          title={item.title_label}
          originalTitle={item.original_title_label}
          variant="poster"
          className="line-clamp-2 text-[13px] font-[500] leading-[1.35] tracking-[-0.01em] text-[#e8e8f0] transition-colors duration-200 group-hover:text-[#f4f4fa]"
        />
        <MetaLine item={item} />
      </Link>

    </article>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function TrendingNowSection() {
  const [items, setItems]     = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<MediaFilter>("all");

  const { ref: rowRef, canScrollLeft, canScrollRight, scrollLeft: doScrollLeft, scrollRight: doScrollRight } =
    useScrollRow({ step: 640 });

  useEffect(() => {
    fetchTrending().then((data) => { setItems(data); setLoading(false); });
  }, []);

  const visible = filter === "all" ? items : items.filter((i) => i.media_type === filter);

  return (
    <section>
      <SectionHeader
        title="Em alta agora"
        subtitle="O que todo mundo está assistindo."
        action={
          <div className="flex items-center gap-3">
            <FilterPills active={filter} onChange={setFilter} />
            <div className="hidden md:flex">
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
        <div className="no-scrollbar flex gap-4 overflow-x-auto pb-4 pt-3">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-[#52526a]">Nenhum resultado encontrado.</p>
      ) : (
        <div
          ref={rowRef}
          className="no-scrollbar flex gap-4 overflow-x-auto pb-4 pt-3"
        >
          {visible.map((item, idx) => (
            <TrendingCard key={item.id} item={item} rank={idx + 1} />
          ))}
        </div>
      )}
    </section>
  );
}

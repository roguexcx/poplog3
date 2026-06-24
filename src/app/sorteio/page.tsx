"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";
import {
  getCanonicalProviderDisplayName,
  resolveProviderLogoForRender,
} from "@/lib/streaming/provider-display";
import { useRandomizedTitleDisplay } from "@/components/titles/LocalizedTitle";
import {
  ArrowRight,
  Bookmark,
  Check,
  Clapperboard,
  Eye,
  EyeOff,
  Film,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Tv,
} from "lucide-react";
import type { SorteioItem } from "@/server/sorteio/sorteio-engine";

type AgendaItem = SorteioItem;
type TypeFilter = "all" | "movie" | "tv";
type VibeFilter = "all" | "intense" | "light" | "surprise";
type PoolMode = "discovery" | "watchlist";

type PoolMeta = {
  fallback: string;
  recentWindowDays: number;
  recentDemotedCount: number;
  totalBeforeFallback: number;
  poolCount: number;
};

const GENRES: Record<number, string> = {
  28: "Ação",
  12: "Aventura",
  16: "Animação",
  35: "Comédia",
  80: "Crime",
  99: "Documentário",
  18: "Drama",
  10751: "Família",
  14: "Fantasia",
  27: "Terror",
  9648: "Mistério",
  10749: "Romance",
  878: "Ficção científica",
  53: "Suspense",
  10752: "Guerra",
  10759: "Ação & aventura",
  10765: "Ficção & fantasia",
  36: "História",
};

function IMG(path: string | null | undefined, size: string): string | null {
  return resolveCatalogImage(path, size);
}

function releaseYear(item: AgendaItem): string | null {
  const date = "release_date" in item ? item.release_date : item.first_air_date;
  return date?.slice(0, 4) ?? null;
}

function genreLabels(ids: number[] = []): string[] {
  return ids.slice(0, 3).map((id) => GENRES[id]).filter(Boolean);
}

function itemKey(item: AgendaItem) {
  return `${item.media_type}-${item.id}`;
}

function libraryLabel(item: AgendaItem) {
  const state = item.user_computed_state ?? item.user_status;
  switch (state) {
    case "watchlist":
      return "Na watchlist";
    case "in_progress":
    case "watching":
      return "Em andamento";
    case "up_to_date":
      return "Em dia";
    case "completed":
    case "watched":
      return "Já visto";
    case "abandoned":
      return "Abandonado";
    case "fridge":
      return "Na geladeira";
    default:
      return "Fora da biblioteca";
  }
}

function contextMessage(item: AgendaItem): string {
  const genres = item.genre_ids ?? [];
  const providerName =
    getCanonicalProviderDisplayName({ name: item.best_provider_name }) ?? item.best_provider_name;
  if (item.is_preferred_provider && item.best_provider_name) {
    return `Está no seu streaming favorito: ${providerName}`;
  }
  if (providerName) return `Disponível em ${providerName}`;
  if (genres.includes(27)) return "Uma escolha para apagar as luzes";
  if (genres.includes(35)) return "Leve, esperto e bom para descompressão";
  if (genres.includes(80) || genres.includes(53)) return "Tensão com pulso de maratona";
  if (genres.includes(878) || genres.includes(10765)) return "Uma janela para outro universo";
  if (genres.includes(18)) return "Drama com cara de descoberta editorial";
  return item.media_type === "tv" ? "Série em circulação agora" : "Filme com energia de noite principal";
}

function providerTypeLabel(type?: string | null) {
  switch (type) {
    case "streaming":
      return "Streaming";
    case "rent":
      return "Aluguel";
    case "buy":
      return "Compra";
    case "free":
      return "Grátis";
    case "ads":
      return "Com anúncios";
    default:
      return "Disponibilidade";
  }
}

function FilterPill({
  label,
  active,
  onClick,
  className = "",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 min-w-0 shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-center text-[11px] font-bold transition sm:min-h-0 sm:px-3 sm:py-1.5 ${
        active
          ? "border-white/22 bg-white/12 text-white"
          : "border-white/10 bg-white/[0.03] text-white/42 hover:border-white/18 hover:text-white/70"
      } ${className}`}
    >
      {label}
    </button>
  );
}

function typeLabel(type: TypeFilter) {
  switch (type) {
    case "movie":
      return "Filmes";
    case "tv":
      return "Séries";
    default:
      return "Tudo";
  }
}

function vibeLabel(vibe: VibeFilter) {
  switch (vibe) {
    case "surprise":
      return "Surpresa";
    case "intense":
      return "Intenso";
    case "light":
      return "Leve";
    default:
      return "Qualquer vibe";
  }
}

function mobileFilterSummary(
  poolMode: PoolMode,
  typeFilter: TypeFilter,
  vibeFilter: VibeFilter,
) {
  const source = poolMode === "watchlist" ? "Watchlist" : "Desc.";
  const vibe = vibeFilter === "all" ? "Livre" : vibeLabel(vibeFilter);
  return `${source} · ${typeLabel(typeFilter)} · ${vibe}`;
}

function MysteryCard({
  index,
  active,
  image,
  onClick,
}: {
  index: number;
  active: boolean;
  image: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative h-[236px] overflow-hidden rounded-[22px] border text-left shadow-2xl transition duration-500 min-[390px]:h-[260px] sm:h-[420px] sm:rounded-[26px] ${
        active
          ? "scale-[1.02] border-cyan-200/35 shadow-cyan-950/40"
          : "border-white/10 shadow-black/40 hover:-translate-y-2 hover:border-white/24"
      }`}
      style={{ transformStyle: "preserve-3d" }}
    >
      {image && <img src={image} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-xl" />}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.18),transparent_30%),linear-gradient(145deg,rgba(8,11,20,0.92),rgba(16,23,42,0.72)_42%,rgba(4,6,12,0.96))]" />
      <div className="absolute inset-px rounded-[21px] border border-white/10 sm:rounded-[25px]" />
      <div className="absolute -inset-x-24 top-0 h-24 rotate-12 bg-white/10 blur-2xl transition duration-700 group-hover:translate-y-28 sm:h-32" />
      <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "linear-gradient(90deg, white 1px, transparent 1px)", backgroundSize: "18px 18px" }} />

      <div className="relative flex h-full flex-col justify-between p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <span className="rounded-full border border-white/12 bg-black/30 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white/45">
            Carta {String(index + 1).padStart(2, "0")}
          </span>
          <Sparkles className="h-4 w-4 text-cyan-100/60" />
        </div>

        <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-white/12 bg-white/[0.04] shadow-[0_0_70px_rgba(125,211,252,0.18)] sm:h-28 sm:w-28">
          <Clapperboard className="h-8 w-8 text-white/62 sm:h-11 sm:w-11" />
        </div>

        <div>
          <div className="mb-3 h-px w-full bg-gradient-to-r from-transparent via-white/24 to-transparent" />
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/38">
            Selecao POPLOG
          </p>
          <p className="mt-2 text-sm font-semibold text-white/72">Mistério em cartaz</p>
        </div>
      </div>
    </button>
  );
}

function ProviderBadge({ item }: { item: AgendaItem }) {
  if (!item.best_provider_name) {
    return (
      <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] font-bold text-white/42">
        <Eye className="h-4 w-4" />
        Sem provider confirmado
      </div>
    );
  }

  const providerName =
    getCanonicalProviderDisplayName({ name: item.best_provider_name }) ?? item.best_provider_name;
  const logo = resolveProviderLogoForRender({
    name: providerName,
    logoUrl: item.best_provider_logo,
  });

  return (
    <div
      className={`inline-flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-2 backdrop-blur-md ${
        item.is_preferred_provider
          ? "border-cyan-200/28 bg-cyan-300/10"
          : "border-white/10 bg-white/[0.05]"
      }`}
    >
      {logo ? (
        <img src={logo} alt={providerName} className="h-8 w-8 rounded-lg object-contain" />
      ) : (
        <div className="h-8 w-8 rounded-lg bg-white/10" />
      )}
      <div className="min-w-0">
        <p className="truncate text-[13px] font-black text-white/90">{providerName}</p>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-100/62">
          {item.is_preferred_provider ? "Seu streaming" : providerTypeLabel(item.best_provider_type)}
        </p>
      </div>
    </div>
  );
}

function ResultCard({
  item,
  saving,
  saved,
  dismissing,
  onSave,
  onAgain,
  onOpen,
  onDismiss,
}: {
  item: AgendaItem;
  saving: boolean;
  saved: boolean;
  dismissing: boolean;
  onSave: () => void;
  onAgain: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const poster = IMG(item.poster_path, "w500");
  const backdrop = IMG(item.backdrop_path, "w1280");
  const year = releaseYear(item);
  const genres = genreLabels(item.genre_ids);
  const isMovie = item.media_type === "movie";
  const { mainTitle, subTitle } = useRandomizedTitleDisplay(item.title, item.original_title);

  return (
    <section className="relative overflow-hidden rounded-[22px] border border-white/12 bg-[#070a12] shadow-2xl shadow-black/50 sm:rounded-[28px]">
      {backdrop && (
        <div className="absolute inset-0">
          <img src={backdrop} alt="" className="h-full w-full object-cover opacity-24" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#070a12] via-[#070a12]/88 to-[#070a12]/42" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#070a12] via-transparent to-black/36" />
        </div>
      )}

      <div className="relative grid gap-0 md:grid-cols-[minmax(180px,260px)_1fr]">
        <div className="absolute left-4 top-4 z-10 aspect-[2/3] w-[96px] overflow-hidden rounded-[16px] border border-white/10 shadow-xl shadow-black/35 min-[390px]:w-[108px] md:relative md:left-auto md:top-auto md:mx-0 md:mt-0 md:min-h-[520px] md:w-auto md:rounded-none md:border-0 md:shadow-none">
          {poster ? (
            <img src={poster} alt={item.title} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-white/[0.04]">
              <Film className="h-12 w-12 text-white/28" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#070a12] via-transparent to-transparent md:bg-gradient-to-r md:from-transparent md:to-[#070a12]/80" />
          <div className="absolute left-2 top-2 rounded-full border border-white/14 bg-black/50 px-2 py-1 text-[8px] font-black uppercase tracking-[0.16em] text-white/58 backdrop-blur sm:left-4 sm:top-4 sm:px-3 sm:text-[10px]">
            Revelado
          </div>
        </div>

        <div className="flex min-h-0 flex-col justify-between p-4 sm:p-8 md:min-h-[420px]">
          <div>
            <div className="min-h-[144px] pl-[112px] min-[390px]:min-h-[162px] min-[390px]:pl-[128px] md:min-h-0 md:pl-0">
              <div className="mb-3 flex flex-wrap items-center gap-1.5 sm:mb-5 sm:gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${
                  isMovie
                    ? "border-rose-300/24 bg-rose-300/10 text-rose-100/75"
                    : "border-cyan-300/24 bg-cyan-300/10 text-cyan-100/75"
                }`}>
                  {isMovie ? <Film className="h-3.5 w-3.5" /> : <Tv className="h-3.5 w-3.5" />}
                  {isMovie ? "Filme" : "Série"}
                </span>
                {year && <span className="text-[11px] font-bold text-white/38">{year}</span>}
                {genres.map((genre) => (
                  <span key={genre} className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-bold text-white/38">
                    {genre}
                  </span>
                ))}
              </div>

              <h2 className="max-w-2xl text-[25px] font-black leading-[1.02] tracking-[-0.02em] text-white min-[390px]:text-[28px] sm:text-[52px] sm:leading-[0.95] sm:tracking-[-0.04em]">
                {mainTitle}
                {subTitle && (
                  <span className="mt-1 block text-[14px] font-light tracking-normal text-white/40 sm:text-[18px]">
                    {subTitle}
                  </span>
                )}
              </h2>
            </div>

            {item.overview && (
              <p className="mt-4 max-w-2xl text-[13px] leading-6 text-white/60 sm:mt-5 sm:text-sm">
                {item.overview}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-2.5 sm:mt-6 sm:gap-3">
              <ProviderBadge item={item} />
              <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] font-bold text-white/56">
                <Bookmark className="h-4 w-4 text-white/42" />
                {libraryLabel(item)}
              </div>
              {(item.vote_average ?? 0) > 0 && (
                <div className="inline-flex items-center gap-2 rounded-2xl border border-amber-300/18 bg-amber-300/10 px-3 py-2 text-[12px] font-black text-amber-100/78">
                  {item.vote_average.toFixed(1)}
                  <span className="text-[10px] uppercase tracking-[0.14em] text-amber-100/42">TMDB</span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-7 sm:mt-8">
            <div className="mb-4 flex max-w-full items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 sm:mb-5 sm:inline-flex sm:items-center sm:px-4">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyan-200/80 sm:mt-0" />
              <p className="min-w-0 text-[12px] font-semibold italic leading-5 text-white/56 sm:truncate">&quot;{contextMessage(item)}&quot;</p>
            </div>

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={onAgain}
                className="order-2 inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[13px] font-black text-white/62 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white sm:order-none sm:flex-none sm:justify-start"
              >
                <RotateCcw className="h-4 w-4" />
                Nova carta
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving || saved}
                className={`order-3 inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-[13px] font-black transition disabled:pointer-events-none sm:order-none sm:flex-none sm:justify-start ${
                  saved
                    ? "border-emerald-300/28 bg-emerald-300/12 text-emerald-100"
                    : "border-cyan-300/24 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/16"
                }`}
              >
                {saved ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                {saved ? "Na watchlist" : saving ? "Guardando" : "Guardar"}
              </button>
              <button
                type="button"
                onClick={onOpen}
                className="order-1 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/16 bg-white px-5 py-3 text-[13px] font-black text-[#070a12] transition hover:bg-cyan-50 sm:order-none sm:w-auto sm:justify-start"
              >
                Ver titulo
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onDismiss}
                disabled={dismissing}
                className="order-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/8 bg-transparent px-4 py-3 text-[13px] font-black text-white/28 transition hover:border-red-400/20 hover:bg-red-400/8 hover:text-red-300/70 disabled:pointer-events-none sm:order-none sm:w-auto sm:justify-start"
              >
                <EyeOff className="h-4 w-4" />
                Não tenho interesse
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-[236px] rounded-[22px] border border-white/8 bg-white/[0.035] min-[390px]:h-[260px] sm:h-[420px] sm:rounded-[26px]" />
      ))}
    </div>
  );
}

export default function SorteioPage() {
  const router = useRouter();
  const [pool, setPool] = useState<AgendaItem[]>([]);
  const [poolMeta, setPoolMeta] = useState<PoolMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDrawing, setIsDrawing] = useState(false);
  const [poolMode, setPoolMode] = useState<PoolMode>("discovery");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [vibeFilter, setVibeFilter] = useState<VibeFilter>("all");
  const [revealedItem, setRevealedItem] = useState<AgendaItem | null>(null);
  const [activeCard, setActiveCard] = useState<number | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      mode: poolMode,
      type: typeFilter,
      vibe: vibeFilter,
    });

    setIsLoading(true);
    fetch(`/api/sorteio/pool?${params.toString()}`)
      .then((response) => response.json())
      .then((response: { data?: { items: AgendaItem[]; meta: PoolMeta } }) => {
        if (cancelled) return;
        const items = response.data?.items ?? [];
        setPool(items);
        setPoolMeta(response.data?.meta ?? null);
        setSavedKeys((current) => new Set([
          ...current,
          ...items.filter((item) => item.user_status === "watchlist").map(itemKey),
        ]));
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [poolMode, typeFilter, vibeFilter]);

  const fallbackActive = poolMode === "discovery" && Boolean(poolMeta?.fallback.includes("general_pool"));
  const displayedPoolCount = poolMeta?.poolCount ?? pool.length;

  const previewImages = useMemo(() => {
    const candidates = pool;
    return [0, 1, 2].map((offset) => IMG(candidates[offset % Math.max(candidates.length, 1)]?.backdrop_path, "w780"));
  }, [pool]);

  const background = IMG((revealedItem ?? pool[0])?.backdrop_path, "w1280");

  const revealCard = useCallback(
    async (index: number) => {
      if (pool.length === 0) return;
      setActiveCard(index);
      setIsDrawing(true);
      try {
        const response = await fetch("/api/sorteio/draw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: poolMode,
            type: typeFilter,
            vibe: vibeFilter,
          }),
        });
        const payload = await response.json() as { data?: { item: AgendaItem | null; meta: PoolMeta } };
        window.setTimeout(() => {
          if (payload.data?.item) setRevealedItem(payload.data.item);
          if (payload.data?.meta) setPoolMeta(payload.data.meta);
          setIsDrawing(false);
        }, 260);
      } catch (err) {
        console.error(err);
        setIsDrawing(false);
      }
    },
    [pool.length, poolMode, typeFilter, vibeFilter],
  );

  const resetReveal = useCallback(() => {
    setRevealedItem(null);
    setActiveCard(null);
  }, []);

  const saveCurrent = useCallback(async () => {
    if (!revealedItem) return;
    const key = itemKey(revealedItem);
    setSavingKey(key);

    try {
      const response = await fetch("/api/library/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdbId: revealedItem.id,
          mediaType: revealedItem.media_type,
          status: "watchlist",
        }),
      });

      if (response.ok) {
        setSavedKeys((current) => new Set(current).add(key));
      }
    } finally {
      setSavingKey(null);
    }
  }, [revealedItem]);

  const dismissCurrent = useCallback(async () => {
    if (!revealedItem) return;
    setIsDismissing(true);
    try {
      await fetch("/api/user/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdb_id: revealedItem.id,
          media_type: revealedItem.media_type,
          feedback_type: "not_interested",
          source: "sorteio",
        }),
      });
      setRevealedItem(null);
      setActiveCard(null);
    } finally {
      setIsDismissing(false);
    }
  }, [revealedItem]);

  function setQuickMode(mode: VibeFilter) {
    setVibeFilter(mode);
    setRevealedItem(null);
    setActiveCard(null);
    setMobileFiltersOpen(false);
  }

  function setTypeMode(mode: TypeFilter) {
    setTypeFilter(mode);
    setRevealedItem(null);
    setActiveCard(null);
    setMobileFiltersOpen(false);
  }

  function setSourceMode(mode: PoolMode) {
    setPoolMode(mode);
    setRevealedItem(null);
    setActiveCard(null);
    setMobileFiltersOpen(false);
  }

  return (
    <div className="relative -mx-4 min-h-[calc(100dvh-80px)] overflow-hidden px-4 pb-24 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8 md:pb-20 lg:-mx-10 lg:px-10">
      <div className="absolute inset-0 -z-10">
        {background && <img src={background} alt="" className="h-full w-full scale-110 object-cover opacity-16 blur-3xl" />}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(125,211,252,0.12),transparent_34rem),linear-gradient(180deg,rgba(2,6,23,0.58),rgba(2,6,23,0.94)_46%,#020617)]" />
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "linear-gradient(0deg, white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)", backgroundSize: "64px 64px" }} />
      </div>

      <div className="mx-auto max-w-[1120px] pt-5 sm:pt-10">
        <header className="mb-5 flex flex-col gap-4 sm:mb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="h-px w-7 bg-cyan-200/60" />
              <p className="text-[10px] font-black uppercase tracking-[0.26em] text-cyan-100/62">Ritual de descoberta</p>
            </div>
            <h1 className="text-[42px] font-black leading-none tracking-[-0.04em] text-white sm:text-[72px] sm:tracking-[-0.055em]">
              Sorteio
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/42">
              {displayedPoolCount} títulos no corte atual
              {fallbackActive ? " · fallback geral ativo" : ""}
              {poolMode === "watchlist" ? " · sorteio exclusivo da watchlist" : ""}
            </p>
          </div>

          <div className="hidden gap-2 sm:flex sm:flex-wrap sm:items-center lg:justify-end">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <FilterPill className="w-full sm:w-auto" label="Descoberta" active={poolMode === "discovery"} onClick={() => setSourceMode("discovery")} />
              <FilterPill className="w-full sm:w-auto" label="Minha watchlist" active={poolMode === "watchlist"} onClick={() => setSourceMode("watchlist")} />
            </div>
            <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
              <FilterPill className="w-full sm:w-auto" label="Tudo" active={typeFilter === "all"} onClick={() => setTypeMode("all")} />
              <FilterPill className="w-full sm:w-auto" label="Filmes" active={typeFilter === "movie"} onClick={() => setTypeMode("movie")} />
              <FilterPill className="w-full sm:w-auto" label="Séries" active={typeFilter === "tv"} onClick={() => setTypeMode("tv")} />
            </div>
          </div>
        </header>

        <div className="mb-5 sm:hidden">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen((open) => !open)}
            className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-2.5 text-left transition hover:border-white/18 hover:bg-white/[0.07]"
            aria-expanded={mobileFiltersOpen}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cyan-300/10 text-cyan-100/72">
              <SlidersHorizontal className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-white/38">
                Filtros
              </span>
              <span className="mt-0.5 block truncate text-[12px] font-bold text-white/76">
                {mobileFilterSummary(poolMode, typeFilter, vibeFilter)}
              </span>
            </span>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white/44">
              {mobileFiltersOpen ? "Fechar" : "Editar"}
            </span>
          </button>

          {mobileFiltersOpen && (
            <div className="mt-2 rounded-2xl border border-white/10 bg-black/18 p-2.5">
              <div className="grid grid-cols-2 gap-2">
                <FilterPill className="w-full" label="Descoberta" active={poolMode === "discovery"} onClick={() => setSourceMode("discovery")} />
                <FilterPill className="w-full" label="Watchlist" active={poolMode === "watchlist"} onClick={() => setSourceMode("watchlist")} />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <FilterPill className="w-full" label="Tudo" active={typeFilter === "all"} onClick={() => setTypeMode("all")} />
                <FilterPill className="w-full" label="Filmes" active={typeFilter === "movie"} onClick={() => setTypeMode("movie")} />
                <FilterPill className="w-full" label="Séries" active={typeFilter === "tv"} onClick={() => setTypeMode("tv")} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <FilterPill className="w-full" label="Qualquer" active={vibeFilter === "all"} onClick={() => setQuickMode("all")} />
                <FilterPill className="w-full" label="Surpresa" active={vibeFilter === "surprise"} onClick={() => setQuickMode("surprise")} />
                <FilterPill className="w-full" label="Intenso" active={vibeFilter === "intense"} onClick={() => setQuickMode("intense")} />
                <FilterPill className="w-full" label="Leve" active={vibeFilter === "light"} onClick={() => setQuickMode("light")} />
              </div>
              <button
                type="button"
                onClick={resetReveal}
                className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] font-bold text-white/42 transition hover:text-white/70"
              >
                <Shuffle className="h-3.5 w-3.5" />
                Reembaralhar
              </button>
            </div>
          )}
        </div>

        <div className="mb-6 hidden grid-cols-2 gap-2 sm:mb-8 sm:flex sm:flex-wrap">
          <FilterPill className="w-full sm:w-auto" label="Qualquer vibe" active={vibeFilter === "all"} onClick={() => setQuickMode("all")} />
          <FilterPill className="w-full sm:w-auto" label="Surpresa total" active={vibeFilter === "surprise"} onClick={() => setQuickMode("surprise")} />
          <FilterPill className="w-full sm:w-auto" label="Algo intenso" active={vibeFilter === "intense"} onClick={() => setQuickMode("intense")} />
          <FilterPill className="w-full sm:w-auto" label="Algo leve" active={vibeFilter === "light"} onClick={() => setQuickMode("light")} />
          <button
            type="button"
            onClick={resetReveal}
            className="col-span-2 inline-flex min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] font-bold text-white/42 transition hover:text-white/70 sm:col-span-1 sm:min-h-0 sm:w-auto sm:px-3 sm:py-1.5"
          >
            <Shuffle className="h-3.5 w-3.5" />
            Reembaralhar
          </button>
        </div>

        {isLoading ? (
          <LoadingSkeleton />
        ) : pool.length === 0 ? (
          <div className="grid min-h-[360px] place-items-center rounded-[28px] border border-white/10 bg-white/[0.035] text-center">
            <p className="max-w-sm px-6 text-sm font-semibold text-white/48">
              {poolMode === "watchlist"
                ? "Sua watchlist ainda não tem títulos sorteáveis neste corte."
                : "Nenhum título disponível no momento."}
            </p>
          </div>
        ) : revealedItem ? (
          <ResultCard
            item={revealedItem}
            saved={savedKeys.has(itemKey(revealedItem))}
            saving={savingKey === itemKey(revealedItem)}
            dismissing={isDismissing}
            onSave={saveCurrent}
            onAgain={resetReveal}
            onOpen={() => router.push(`/title/${revealedItem.media_type}/${revealedItem.id}`)}
            onDismiss={dismissCurrent}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <MysteryCard
                key={index}
                index={index}
                active={activeCard === index}
                image={previewImages[index]}
                onClick={() => {
                  if (!isDrawing) void revealCard(index);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

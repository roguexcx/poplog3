"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Bookmark, Heart, PlayCircle, Calendar, CheckCircle2,
  Pause, X, Filter, ChevronLeft, ChevronRight,
} from "lucide-react";

import { TmdbImageLegacy as TmdbImage } from "@/components/images/TmdbImage";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import SectionHeader from "@/components/ui/SectionHeader";
import type { Poplog3UserLibraryItem } from "@/server/library/library-service";

import LibraryEmptyState from "./LibraryEmptyState";
import LibraryGrid from "./LibraryGrid";
import LibraryHero from "./LibraryHero";
import LibraryPosterCard from "./LibraryPosterCard";
import { type LibraryTab } from "./LibraryTabs";

// ── Types ─────────────────────────────────────────────────────────────────────

type MediaFilter = "all" | "movie" | "tv";

type SortBy =
  | "release-desc"
  | "recent"
  | "title-asc"
  | "release-asc"
  | "popularity-desc"
  | "runtime-asc"
  | "runtime-desc";

type ExtendedStats = {
  watchlist:  number;
  favorites:  number;
  watching:   number;
  comingSoon: number;
  watched:    number;
  fridge:     number;
  abandoned:  number;
  total:      number;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const THEATER_WINDOW_DAYS = 45;

const MEDIA_OPTIONS: { id: MediaFilter; label: string }[] = [
  { id: "all",   label: "Tudo"   },
  { id: "movie", label: "Filmes" },
  { id: "tv",    label: "Séries" },
];

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "popularity-desc", label: "Popularidade"       },
  { value: "recent",          label: "Adicionados recente" },
  { value: "release-desc",    label: "Lançamento (+ novo)" },
  { value: "release-asc",     label: "Lançamento (+ antigo)" },
  { value: "title-asc",       label: "Nome (A–Z)"          },
  { value: "runtime-desc",    label: "Duração (+ longo)"   },
  { value: "runtime-asc",     label: "Duração (+ curto)"   },
];

const TAB_OPTIONS: { id: LibraryTab; label: string }[] = [
  { id: "all",          label: "Tudo"        },
  { id: "watchlist",    label: "Watchlist"   },
  { id: "favorites",    label: "Favoritos"   },
  { id: "watching",     label: "Maratonando" },
  { id: "coming-soon",  label: "Em Breve"    },
  { id: "watched",      label: "Concluídos"  },
  { id: "abandoned",    label: "Abandonados" },
  { id: "fridge",       label: "Geladeira"   },
];

const STATUS_BADGE_CLASSES: Record<string, string> = {
  watching:  "border-violet-300/35 bg-violet-500/20 text-violet-100",
  watchlist: "border-cyan-300/30  bg-cyan-500/18  text-cyan-100",
  watched:   "border-white/[0.12] bg-white/[0.08] text-white/72",
  abandoned: "border-rose-300/30  bg-rose-500/16  text-rose-100",
  fridge:    "border-amber-300/30 bg-amber-500/16 text-amber-100",
};

const STATUS_LABEL: Record<string, string> = {
  watchlist: "Na Lista",
  watching:  "Em Andamento",
  watched:   "Assistido",
  abandoned: "Abandonado",
  fridge:    "Geladeira",
};

// ── Main component ────────────────────────────────────────────────────────────

type LibraryPageProps = {
  library:     Poplog3UserLibraryItem[];
  initialTab?: string;
};

export default function LibraryPage({ library, initialTab }: LibraryPageProps) {
  const defaultTab: LibraryTab = isValidLibraryTab(initialTab) ? initialTab : "all";

  const [activeTab,         setActiveTab]         = useState<LibraryTab>(defaultTab);
  const [mediaFilter,       setMediaFilter]       = useState<MediaFilter>("all");
  const [yearFilter,        setYearFilter]        = useState<number | null>(null);
  const [sortBy,            setSortBy]            = useState<SortBy>("popularity-desc");
  const [page,              setPage]              = useState(1);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const gridSectionRef = useRef<HTMLDivElement>(null);
  const itemsPerPage   = useLibraryItemsPerPage();

  useWatchlistHydration(library, activeTab);

  // Extended stats
  const extendedStats = useMemo<ExtendedStats>(() => ({
    watchlist:  library.filter((i) => isPureWatchlist(i) && !isComingSoon(i)).length,
    favorites:  library.filter((i) => i.favorite === true && !isComingSoon(i)).length,
    watching:   library.filter(isMarathoning).length,
    comingSoon: library.filter(isComingSoon).length,
    watched:    library.filter(isCompletedOrUpToDate).length,
    fridge:     library.filter((i) => i.status === "fridge").length,
    abandoned:  library.filter((i) => i.status === "abandoned").length,
    total:      library.length,
  }), [library]);

  // Spotlight: escolha pseudoaleatória, mas determinística para evitar mismatch de hidratação.
  const spotlightItem = useMemo<Poplog3UserLibraryItem | null>(() => {
    const candidates = library.filter((i) => !!(i.title?.backdrop_path || i.title?.poster_path));
    if (candidates.length === 0) return null;
    const seed = library.reduce((acc, item) => {
      const id = typeof item.tmdb_id === "number" && Number.isFinite(item.tmdb_id) ? item.tmdb_id : 0;
      return (acc + id * 31 + (item.media_type?.length ?? 0) * 17) % 1_000_003;
    }, library.length * 97);
    const idx = Number.isFinite(seed) ? seed % candidates.length : 0;
    return candidates[idx] ?? null;
  }, [library]);

  useEffect(() => {
    if (spotlightItem === null)      console.warn("[spotlight] null — candidates vazio");
    else if (spotlightItem === undefined) console.warn("[spotlight] undefined — useMemo sem return");
    else console.log("[spotlight] ok —", spotlightItem.title?.title ?? spotlightItem.title?.original_title ?? `tmdb:${spotlightItem.tmdb_id}`);
  }, [spotlightItem]);

  // Editorial rails
  const watchlistItems = useMemo(() =>
    library
      .filter((i) => isPureWatchlist(i) && !isComingSoon(i))
      .sort((a, b) => getPopularity(b) - getPopularity(a))
      .slice(0, 12),
    [library]);

  const recentItems = useMemo(() =>
    library
      .filter((i) => !isComingSoon(i) && i.status !== "abandoned")
      .sort((a, b) => getAddedTime(b) - getAddedTime(a))
      .slice(0, 8),
    [library]);

  const shortestItems = useMemo(() => {
    const withRuntime = library.filter((i) => !isComingSoon(i) && !isCompletedOrUpToDate(i) && getTotalRuntime(i) !== null);
    const movies = withRuntime.filter((i) => i.media_type === "movie");
    const tv     = withRuntime.filter((i) => i.media_type === "tv");
    return [...movies, ...tv]
      .sort((a, b) => (getTotalRuntime(a) ?? Infinity) - (getTotalRuntime(b) ?? Infinity))
      .slice(0, 8);
  }, [library]);

  const favoritesItems = useMemo(() =>
    library
      .filter((i) => i.favorite === true && !isComingSoon(i))
      .sort((a, b) => getPopularity(b) - getPopularity(a))
      .slice(0, 10),
    [library]);

  const comingSoonItems = useMemo(() =>
    library
      .filter(isComingSoon)
      .sort((a, b) => getReleaseTime(a) - getReleaseTime(b))
      .slice(0, 6),
    [library]);

  // Available years for year filter dropdown
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    library.forEach((i) => {
      const y = i.title?.year;
      if (typeof y === "number" && y > 1900) years.add(y);
    });
    return [...years].sort((a, b) => b - a);
  }, [library]);

  // Filtered + sorted items for the main grid
  const filteredLibrary = useMemo(() => {
    let items = [...library];

    if (activeTab === "coming-soon") {
      items = items.filter(isComingSoon);
    } else {
      items = items.filter((i) => !isComingSoon(i));
      if      (activeTab === "favorites") items = items.filter((i) => i.favorite === true);
      else if (activeTab === "watching")  items = items.filter(isMarathoning);
      else if (activeTab === "watched")   items = items.filter(isCompletedOrUpToDate);
      else if (activeTab === "watchlist") items = items.filter(isPureWatchlist);
      else if (activeTab !== "all")       items = items.filter((i) => i.status === activeTab);
    }

    if (mediaFilter !== "all")    items = items.filter((i) => i.media_type === mediaFilter);
    if (yearFilter  !== null)     items = items.filter((i) => i.title?.year === yearFilter);

    items.sort((a, b) => sortLibraryItems(a, b, sortBy));
    return items;
  }, [library, activeTab, mediaFilter, yearFilter, sortBy]);

  const totalPages     = Math.max(1, Math.ceil(filteredLibrary.length / itemsPerPage));
  const safePage       = Math.min(page, totalPages);
  const visibleLibrary = useMemo(() => {
    const start = (safePage - 1) * itemsPerPage;
    return filteredLibrary.slice(start, start + itemsPerPage);
  }, [filteredLibrary, safePage, itemsPerPage]);

  useEffect(() => { setPage(1); }, [activeTab, mediaFilter, yearFilter, sortBy, itemsPerPage]);

  const hasActiveFilters = activeTab !== "all" || mediaFilter !== "all" || yearFilter !== null;

  function scrollToGrid(tab: LibraryTab, sort: SortBy = "popularity-desc") {
    setActiveTab(tab);
    setSortBy(sort);
    setMediaFilter("all");
    setYearFilter(null);
    setPage(1);
    setTimeout(() => {
      gridSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function clearFilters() {
    setActiveTab("all");
    setMediaFilter("all");
    setYearFilter(null);
    setSortBy("popularity-desc");
    setPage(1);
  }

  return (
    <div className="relative flex flex-col gap-8 pb-20 md:gap-14 md:pb-0">

      {/* Atmospheric depth */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-48 top-[20%] h-[600px] w-[600px] rounded-full bg-indigo-700/[0.05] blur-[130px]" />
        <div className="absolute -right-40 top-[55%] h-[500px] w-[500px] rounded-full bg-violet-600/[0.04] blur-[110px]" />
        <div className="absolute left-1/3 top-[5%] h-[350px] w-[350px] rounded-full bg-cyan-600/[0.03] blur-[90px]" />
      </div>

      {/* ── 1. Cinematic header ── */}
      <LibraryHero library={library} totalCount={library.length} />

      {/* ── 2. Stats row ── */}
      <LibraryStatsRow stats={extendedStats} onStatClick={scrollToGrid} />

      {/* ── 3. Spotlight + Watchlist ── */}
      {(spotlightItem != null || watchlistItems.length > 0) && (
        <section className="relative grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-6">

          {/* Spotlight */}
          {spotlightItem != null && (
            <div className="flex min-w-0 flex-col gap-3">
              <RailLabel label="Em destaque no seu acervo" />
              <SpotlightCard item={spotlightItem} />
            </div>
          )}

          {/* Watchlist rail */}
          {watchlistItems.length > 0 && (
            <div className="flex min-w-0 flex-col gap-3 lg:h-full">
              <RailHeader
                label="Sua Watchlist"
                subtitle="Tudo que você salvou para assistir"
                onViewAll={() => scrollToGrid("watchlist", "popularity-desc")}
              />
              <div className="relative flex-1 flex flex-col justify-center rounded-[1.5rem] border border-white/[0.08] bg-white/[0.025] p-3 shadow-[0_18px_56px_rgba(0,0,0,0.30)] sm:rounded-[1.75rem] sm:p-4">
                <div className="pointer-events-none absolute -right-12 -top-10 h-40 w-40 rounded-full bg-indigo-500/[0.06] blur-[60px]" />
                <ScrollRail>
                  {watchlistItems.map((item, i) => (
                    <div key={item.id} className="w-[124px] shrink-0 sm:w-[175px]">
                      <LibraryPosterCard item={item} priority={i < 5} />
                    </div>
                  ))}
                </ScrollRail>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── 4. Recently Added + Shortest ── */}
      {(recentItems.length > 0 || shortestItems.length > 0) && (
        <section className="relative grid gap-10 lg:grid-cols-2 lg:gap-8">

          {recentItems.length > 0 && (
            <div className="flex min-w-0 flex-col gap-3">
              <RailHeader
                label="Adicionados Recentemente"
                subtitle="Os últimos títulos registrados no acervo"
                onViewAll={() => scrollToGrid("all", "recent")}
              />
              <ScrollRail>
                {recentItems.map((item, i) => (
                  <div key={item.id} className="w-[118px] shrink-0 sm:w-[140px]">
                    <LibraryPosterCard item={item} priority={i < 4} />
                  </div>
                ))}
              </ScrollRail>
            </div>
          )}

          {shortestItems.length > 0 && (
            <div className="flex min-w-0 flex-col gap-3">
              <RailHeader
                label="Mais Curtos"
                subtitle="Títulos mais rápidos do seu acervo"
                onViewAll={() => scrollToGrid("all", "runtime-asc")}
              />
              <ScrollRail>
                {shortestItems.map((item, i) => (
                  <div key={item.id} className="w-[118px] shrink-0 sm:w-[140px]">
                    <LibraryPosterCard item={item} priority={i < 4} />
                  </div>
                ))}
              </ScrollRail>
            </div>
          )}
        </section>
      )}

      {/* ── 5. Favorites ── */}
      {favoritesItems.length > 0 && (
        <section className="relative">
          <div className="relative overflow-hidden rounded-[1.75rem] border border-rose-500/[0.10] bg-gradient-to-br from-rose-950/[0.25] to-transparent p-5 shadow-[inset_0_1px_0_rgba(255,100,100,0.05)] sm:p-6">
            <div className="pointer-events-none absolute -right-16 -top-12 h-48 w-48 rounded-full bg-rose-500/[0.07] blur-[70px]" />
            <div className="relative flex flex-col gap-3">
              <RailHeader
                label="Favoritos"
                subtitle="Obras marcadas como especiais no seu acervo"
                accent="rose"
                icon={<Heart className="h-3.5 w-3.5 fill-rose-400 text-rose-400" />}
                onViewAll={() => scrollToGrid("favorites", "popularity-desc")}
              />
              <ScrollRail>
                {favoritesItems.map((item, i) => (
                  <div key={item.id} className="w-[118px] shrink-0 sm:w-[148px]">
                    <LibraryPosterCard item={item} priority={i < 5} />
                  </div>
                ))}
              </ScrollRail>
            </div>
          </div>
        </section>
      )}

      {/* ── 6. Coming Soon ── */}
      {comingSoonItems.length > 0 && (
        <section className="relative flex flex-col gap-4">
          <RailHeader
            label="Em Breve"
            subtitle="Títulos que ainda vão chegar na sua coleção"
            accent="amber"
            icon={<Calendar className="h-3.5 w-3.5 text-amber-400" />}
            onViewAll={() => scrollToGrid("coming-soon", "release-asc")}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {comingSoonItems.map((item, i) => (
              <ComingSoonCard key={item.id} item={item} priority={i < 3} />
            ))}
          </div>
        </section>
      )}

      {/* ── 7. Visão Completa da Biblioteca ── */}
      <section
        ref={gridSectionRef}
        className="relative scroll-mt-6 pb-12"
      >
        <SectionHeader
          eyebrow="Acervo completo"
          accent="indigo"
          title="Visão Completa da Biblioteca"
          subtitle="Explore todos os títulos com filtros e ordenação avançada."
          size="md"
          action={
            <span className="rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1 text-[11px] font-bold text-white/50">
              {filteredLibrary.length}{" "}
              {filteredLibrary.length === 1 ? "título" : "títulos"}
            </span>
          }
          className="mb-6"
        />

        {/* Desktop filter bar */}
        <div className="mb-6 hidden md:block">
          <FullFilterBar
            activeTab={activeTab}
            mediaFilter={mediaFilter}
            yearFilter={yearFilter}
            sortBy={sortBy}
            availableYears={availableYears}
            total={filteredLibrary.length}
            hasActiveFilters={hasActiveFilters}
            onTabChange={(t) => { setActiveTab(t); setPage(1); }}
            onMediaChange={(m) => { setMediaFilter(m); setPage(1); }}
            onYearChange={(y) => { setYearFilter(y); setPage(1); }}
            onSortChange={(s) => { setSortBy(s); setPage(1); }}
            onClear={clearFilters}
          />
        </div>

        {/* Mobile filter row */}
        <div className="mb-5 flex items-center justify-between gap-3 md:hidden">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {activeTab !== "all" && (
              <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-[11px] font-medium text-indigo-200">
                {TAB_OPTIONS.find((t) => t.id === activeTab)?.label}
              </span>
            )}
            {mediaFilter !== "all" && (
              <span className="rounded-full bg-white/[0.07] px-2.5 py-0.5 text-[11px] text-white/60">
                {MEDIA_OPTIONS.find((m) => m.id === mediaFilter)?.label}
              </span>
            )}
            {yearFilter !== null && (
              <span className="rounded-full bg-white/[0.07] px-2.5 py-0.5 text-[11px] text-white/60">
                {yearFilter}
              </span>
            )}
            {!hasActiveFilters && (
              <span className="text-[12px] text-white/35">{filteredLibrary.length} títulos</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-3 text-[11px] font-bold text-white/75 transition hover:bg-white/[0.10]"
          >
            <Filter className="h-3.5 w-3.5" />
            Filtrar
          </button>
        </div>

        {/* Grid */}
        {filteredLibrary.length === 0 ? (
          <LibraryEmptyState activeTab={activeTab} />
        ) : (
          <div className="flex flex-col gap-12">
            <LibraryGrid items={visibleLibrary} />
            {totalPages > 1 && (
              <LibraryPagination
                page={safePage}
                totalPages={totalPages}
                total={filteredLibrary.length}
                onPageChange={setPage}
              />
            )}
          </div>
        )}
      </section>

      {/* Mobile filters bottom sheet */}
      {mobileFiltersOpen && (
        <MobileFiltersSheet
          activeTab={activeTab}
          mediaFilter={mediaFilter}
          yearFilter={yearFilter}
          sortBy={sortBy}
          availableYears={availableYears}
          onApply={(tab, media, year, sort) => {
            setActiveTab(tab);
            setMediaFilter(media);
            setYearFilter(year);
            setSortBy(sort);
            setPage(1);
            setMobileFiltersOpen(false);
          }}
          onClose={() => setMobileFiltersOpen(false)}
        />
      )}
    </div>
  );
}

// ── Stats Row ─────────────────────────────────────────────────────────────────

const STAT_CONFIGS: {
  key:         keyof ExtendedStats;
  label:       string;
  description: string;
  tab:         LibraryTab;
  sort:        SortBy;
  icon:        ReactNode;
}[] = [
  {
    key: "watchlist",
    label: "Na lista",
    description: "Salvos para ver depois",
    tab: "watchlist",
    sort: "popularity-desc",
    icon: <Bookmark className="h-4 w-4 text-cyan-400" />,
  },
  {
    key: "favorites",
    label: "Favoritos",
    description: "Os seus preferidos",
    tab: "favorites",
    sort: "popularity-desc",
    icon: <Heart className="h-4 w-4 text-rose-400" />,
  },
  {
    key: "watching",
    label: "Em andamento",
    description: "Em progresso",
    tab: "watching",
    sort: "recent",
    icon: <PlayCircle className="h-4 w-4 text-violet-400" />,
  },
  {
    key: "comingSoon",
    label: "Em breve",
    description: "Ainda não lançados",
    tab: "coming-soon",
    sort: "release-asc",
    icon: <Calendar className="h-4 w-4 text-amber-400" />,
  },
  {
    key: "watched",
    label: "Assistidos",
    description: "Histórico concluído",
    tab: "watched",
    sort: "release-desc",
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  },
  {
    key: "fridge",
    label: "Geladeira",
    description: "Guardados por ora",
    tab: "fridge",
    sort: "recent",
    icon: <Pause className="h-4 w-4 text-amber-300" />,
  },
  {
    key: "abandoned",
    label: "Abandonados",
    description: "Você largou no meio",
    tab: "abandoned",
    sort: "recent",
    icon: <X className="h-4 w-4 text-rose-300" />,
  },
];

function LibraryStatsRow({
  stats,
  onStatClick,
}: {
  stats:       ExtendedStats;
  onStatClick: (tab: LibraryTab, sort: SortBy) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    updateScrollButtons();
    el.addEventListener("scroll", updateScrollButtons, { passive: true });
    const observer = new ResizeObserver(updateScrollButtons);
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", updateScrollButtons);
      observer.disconnect();
    };
  }, [updateScrollButtons]);

  function scrollStats(direction: -1 | 1) {
    scrollerRef.current?.scrollBy({
      left: direction * 224,
      behavior: "smooth",
    });
  }

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className="-mx-4 overflow-x-auto no-scrollbar px-4 pb-1 scroll-smooth sm:mx-0 sm:overflow-x-visible sm:px-0 sm:pb-0"
      >
        <div className="flex w-max gap-2 sm:grid sm:w-auto sm:grid-cols-7 sm:gap-3">
        {STAT_CONFIGS.map((config) => (
          <button
            key={config.key}
            type="button"
            onClick={() => onStatClick(config.tab, config.sort)}
            className="group flex w-[92px] shrink-0 touch-pan-x flex-col gap-2 rounded-[1.1rem] border border-white/[0.08] bg-white/[0.04] px-2.5 py-3 text-left transition hover:border-white/[0.14] hover:bg-white/[0.07] min-[390px]:w-[94px] sm:w-auto sm:rounded-[1.25rem] sm:px-4 sm:py-3.5"
          >
            <div className="flex items-center gap-2">
              {config.icon}
              <span className="text-[22px] font-black tabular-nums leading-none text-white sm:text-2xl">
                {stats[config.key]}
              </span>
            </div>
            <p className="line-clamp-2 min-h-[22px] text-[9px] font-black uppercase tracking-[0.08em] text-white/65 sm:min-h-0 sm:text-[10px] sm:tracking-[0.14em]">
              {config.label}
            </p>
            <p className="text-[10px] leading-tight text-white/30">
              {config.description}
            </p>
          </button>
        ))}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center sm:hidden">
        <button
          type="button"
          aria-label="Ver categorias anteriores"
          disabled={!canScrollLeft}
          onClick={() => scrollStats(-1)}
          className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] bg-[#09090f]/85 text-white/70 shadow-[0_10px_28px_rgba(0,0,0,0.35)] backdrop-blur-md transition disabled:opacity-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center sm:hidden">
        <button
          type="button"
          aria-label="Ver mais categorias"
          disabled={!canScrollRight}
          onClick={() => scrollStats(1)}
          className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] bg-[#09090f]/85 text-white/70 shadow-[0_10px_28px_rgba(0,0,0,0.35)] backdrop-blur-md transition disabled:opacity-0"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Rail helpers ──────────────────────────────────────────────────────────────

function RailLabel({ label }: { label: string }) {
  return (
    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200/65 sm:text-[11px]">
      {label}
    </p>
  );
}

function RailHeader({
  label,
  subtitle,
  accent = "indigo",
  icon,
  onViewAll,
}: {
  label:     string;
  subtitle?: string;
  accent?:   "indigo" | "rose" | "amber" | "cyan";
  icon?:     ReactNode;
  onViewAll?: () => void;
}) {
  const accentText = {
    indigo: "text-indigo-300",
    rose:   "text-rose-300",
    amber:  "text-amber-300",
    cyan:   "text-cyan-300",
  }[accent];

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon && <span>{icon}</span>}
          <h2 className="text-sm font-black uppercase tracking-wide text-white sm:text-[15px]">
            {label}
          </h2>
        </div>
        {subtitle && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-white/38">{subtitle}</p>
        )}
      </div>
      {onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-bold sm:text-[12px] ${accentText} hover:underline`}
        >
          Ver tudo
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Scroll Rail ───────────────────────────────────────────────────────────────

function ScrollRail({
  children,
  className,
}: {
  children:  ReactNode;
  className?: string;
}) {
  const ref      = useRef<HTMLDivElement>(null);
  const [canLeft,  setCanLeft]  = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [update]);

  function scroll(dir: -1 | 1) {
    ref.current?.scrollBy({ left: dir * 300, behavior: "smooth" });
  }

  return (
    <div className="relative">
      {canLeft && (
        <button
          type="button"
          onClick={() => scroll(-1)}
          aria-label="Anterior"
          className="absolute -left-3 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/[0.14] bg-black/75 text-white/80 shadow-lg backdrop-blur-sm transition hover:bg-black/95 hover:text-white sm:flex"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      <div
        ref={ref}
        className={`flex gap-3 overflow-x-auto no-scrollbar pb-3 ${className ?? ""}`}
      >
        {children}
      </div>
      {canRight && (
        <button
          type="button"
          onClick={() => scroll(1)}
          aria-label="Próximo"
          className="absolute -right-3 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/[0.14] bg-black/75 text-white/80 shadow-lg backdrop-blur-sm transition hover:bg-black/95 hover:text-white sm:flex"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ── Coming Soon Card ──────────────────────────────────────────────────────────

function ComingSoonCard({
  item,
  priority,
}: {
  item:      Poplog3UserLibraryItem;
  priority?: boolean;
}) {
  const title        = item.title;
  const displayTitle = title?.title ?? title?.original_title ?? "—";
  const type         = item.media_type === "movie" ? "Filme" : "Série";
  const rating       = title?.vote_average;

  const rawDate =
    item.media_type === "tv"
      ? title?.first_air_date ?? title?.release_date
      : title?.release_date  ?? title?.first_air_date;

  const releaseLabel = rawDate ? formatComingSoonDate(rawDate) : null;
  const linkId = item.imdb_id ?? item.tmdb_id;

  return (
    <Link href={`/title/${item.media_type}/${linkId}`} className="group block">
      <div className="relative overflow-hidden rounded-[1.35rem] border border-white/[0.07] bg-[#07080f] shadow-[0_12px_40px_rgba(0,0,0,0.52)] transition duration-300 group-hover:border-amber-300/[0.18] group-hover:shadow-[0_20px_60px_rgba(0,0,0,0.68)]" style={{ aspectRatio: "16/9" }}>
        {(title?.backdrop_path ?? title?.poster_path) && (
          <TmdbImage
            path={title.backdrop_path ?? title.poster_path ?? null}
            fallbackPath={title.backdrop_path ? (title.poster_path ?? null) : null}
            size="w780"
            alt={displayTitle}
            fallbackLabel={displayTitle}
            priority={priority}
            className="absolute inset-0 h-full w-full object-cover opacity-55 transition duration-500 group-hover:scale-[1.04] group-hover:opacity-70"
          />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(3,4,10,0.96)_0%,rgba(3,4,10,0.38)_55%,rgba(3,4,10,0.18)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(3,4,10,0.52)_0%,transparent_55%)]" />

        {typeof rating === "number" && rating > 0 && (
          <div className="absolute right-3 top-3 rounded-full border border-amber-200/[0.18] bg-black/60 px-2 py-0.5 text-[10px] font-black text-amber-100 backdrop-blur-sm">
            ★ {rating.toFixed(1)}
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
          {releaseLabel && (
            <p className="mb-1 text-[9px] font-black uppercase tracking-[0.20em] text-amber-300/75">
              {releaseLabel}
            </p>
          )}
          <LocalizedTitle
            as="h3"
            variant="compact"
            title={displayTitle}
            originalTitle={title?.original_title}
            className="sm:[&>span:first-child]:text-[15px]"
          />
          <p className="mt-0.5 text-[10px] text-white/40">
            {[title?.year, type].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
    </Link>
  );
}

function formatComingSoonDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

// ── Spotlight Card ────────────────────────────────────────────────────────────

function SpotlightCard({ item }: { item: Poplog3UserLibraryItem }) {
  const title        = item.title;
  const displayTitle = title?.title ?? title?.original_title ?? "—";
  const progress     = typeof item.progress_pct === "number" ? item.progress_pct : null;
  const isWatching   = isMarathoning(item);
  const badgeClass   = STATUS_BADGE_CLASSES[item.status] ?? STATUS_BADGE_CLASSES.watchlist;
  const badgeLabel   = STATUS_LABEL[item.status] ?? item.status;

  const metaParts: string[] = [
    title?.year?.toString() ?? "",
    item.media_type === "movie" ? "Filme" : "Série",
    item.media_type === "tv" && typeof title?.number_of_seasons === "number"
      ? `${title.number_of_seasons} ${title.number_of_seasons === 1 ? "temporada" : "temporadas"}`
      : "",
    item.media_type === "movie" && typeof title?.runtime === "number" && title.runtime > 0
      ? formatMinutes(title.runtime)
      : "",
    item.media_type === "tv" && item.watched_episodes && item.watched_episodes > 0
      ? `Ep. ${item.watched_episodes} assistido${item.watched_episodes !== 1 ? "s" : ""}`
      : "",
  ].filter(Boolean);

  const linkId = item.imdb_id ?? item.tmdb_id;

  return (
    <Link href={`/title/${item.media_type}/${linkId}`} className="group block h-full">
      <div className="relative min-h-[300px] overflow-hidden rounded-[1.5rem] border border-white/[0.08] bg-black/40 shadow-[0_24px_80px_rgba(0,0,0,0.55)] transition duration-300 group-hover:border-white/[0.16] sm:min-h-[380px] sm:rounded-[1.75rem]">
        {/* Backdrop */}
        {(title?.backdrop_path ?? title?.poster_path) && (
          <TmdbImage
            path={title.backdrop_path ?? title.poster_path ?? null}
            fallbackPath={title.backdrop_path ? (title.poster_path ?? null) : null}
            size="w1280"
            alt={displayTitle}
            fallbackLabel={displayTitle}
            priority
            className="absolute inset-0 h-full w-full object-cover opacity-55 transition duration-500 group-hover:scale-[1.03] group-hover:opacity-65"
          />
        )}

        {/* Gradients */}
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(3,4,10,0.97)_0%,rgba(3,4,10,0.50)_50%,rgba(3,4,10,0.20)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(3,4,10,0.60)_0%,transparent_50%)]" />

        {/* Status badge — top left */}
        <div className="absolute left-3 top-3 sm:left-4 sm:top-4">
          <span
            className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] shadow-[0_6px_18px_rgba(0,0,0,0.40)] backdrop-blur-md ${badgeClass}`}
          >
            {badgeLabel}
          </span>
        </div>

        {/* Provider — top right */}
        {resolveCatalogImage(item.best_provider_logo, "original") && (
          <div className="absolute right-3 top-3 overflow-hidden rounded-lg border border-white/[0.14] bg-black/55 shadow-[0_4px_14px_rgba(0,0,0,0.45)] backdrop-blur-md sm:right-4 sm:top-4">
            <Image
              src={resolveCatalogImage(item.best_provider_logo, "original")!}
              alt={item.best_provider_name ?? ""}
              width={28}
              height={28}
              unoptimized
              className="h-7 w-7 object-cover"
            />
          </div>
        )}

        {/* Content — bottom */}
        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
          {metaParts.length > 0 && (
            <p className="mb-2 text-[11px] font-medium text-white/45">
              {metaParts.join(" · ")}
            </p>
          )}
          <LocalizedTitle
            as="h2"
            variant="large"
            title={displayTitle}
            originalTitle={title?.original_title}
            className="[&>span:first-child]:text-[22px] sm:[&>span:first-child]:text-3xl"
          />

          {isWatching && progress !== null && progress > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[11px] text-white/40">
                  {Math.round(progress)}% concluído
                </span>
              </div>
              <div className="h-[3px] overflow-hidden rounded-full bg-white/[0.12]">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-indigo-400 shadow-[0_0_8px_rgba(139,92,246,0.60)]"
                  style={{ width: `${Math.min(100, progress)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

// ── Full Filter Bar (desktop) ─────────────────────────────────────────────────

function FullFilterBar({
  activeTab,
  mediaFilter,
  yearFilter,
  sortBy,
  availableYears,
  total,
  hasActiveFilters,
  onTabChange,
  onMediaChange,
  onYearChange,
  onSortChange,
  onClear,
}: {
  activeTab:        LibraryTab;
  mediaFilter:      MediaFilter;
  yearFilter:       number | null;
  sortBy:           SortBy;
  availableYears:   number[];
  total:            number;
  hasActiveFilters: boolean;
  onTabChange:      (t: LibraryTab) => void;
  onMediaChange:    (m: MediaFilter) => void;
  onYearChange:     (y: number | null) => void;
  onSortChange:     (s: SortBy) => void;
  onClear:          () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[1.25rem] border border-white/[0.08] bg-white/[0.03] px-4 py-3">

      {/* Estado */}
      <FilterSelect
        label="Estado"
        value={activeTab}
        options={TAB_OPTIONS.map((t) => ({ value: t.id, label: t.label }))}
        onChange={(v) => onTabChange(v as LibraryTab)}
      />

      <FilterDivider />

      {/* Tipo */}
      <FilterSelect
        label="Tipo"
        value={mediaFilter}
        options={MEDIA_OPTIONS.map((m) => ({ value: m.id, label: m.label }))}
        onChange={(v) => onMediaChange(v as MediaFilter)}
      />

      {availableYears.length > 1 && (
        <>
          <FilterDivider />
          {/* Ano */}
          <FilterSelect
            label="Ano"
            value={yearFilter?.toString() ?? "all"}
            options={[
              { value: "all", label: "Todos" },
              ...availableYears.map((y) => ({ value: y.toString(), label: y.toString() })),
            ]}
            onChange={(v) => onYearChange(v === "all" ? null : parseInt(v, 10))}
          />
        </>
      )}

      <FilterDivider />

      {/* Ordenar por */}
      <FilterSelect
        label="Ordenar por"
        value={sortBy}
        options={SORT_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
        onChange={(v) => onSortChange(v as SortBy)}
        highlight
      />

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 rounded-full border border-white/[0.08] px-3 py-1 text-[11px] font-medium text-white/40 transition hover:border-white/[0.18] hover:text-white/70"
        >
          Limpar filtros
        </button>
      )}

      {/* Count */}
      <p className="ml-auto text-[12px] text-white/30">
        {total} {total === 1 ? "título" : "títulos"}
      </p>
    </div>
  );
}

function FilterDivider() {
  return <div className="h-4 w-px shrink-0 bg-white/[0.10]" />;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  highlight = false,
}: {
  label:     string;
  value:     string;
  options:   { value: string; label: string }[];
  onChange:  (v: string) => void;
  highlight?: boolean;
}) {
  const isDefault = options[0]?.value === value;

  return (
    <div className="relative flex items-center gap-1.5">
      <span className="text-[10px] font-medium text-white/30">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ colorScheme: "dark" }}
          className={[
            "appearance-none rounded-full border py-1 pl-2.5 pr-6 text-[11px] font-medium transition",
            "bg-transparent outline-none",
            "[&_option]:bg-[#0d0d14] [&_option]:text-white",
            highlight && !isDefault
              ? "border-indigo-400/30 bg-indigo-500/[0.12] text-indigo-100"
              : "border-white/[0.10] text-white/65 hover:border-white/[0.18] hover:text-white",
          ].filter(Boolean).join(" ")}
          aria-label={label}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <ChevronRight className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-white/35" />
      </div>
    </div>
  );
}

// ── Mobile filters bottom sheet ───────────────────────────────────────────────

function MobileFiltersSheet({
  activeTab,
  mediaFilter,
  yearFilter,
  sortBy,
  availableYears,
  onApply,
  onClose,
}: {
  activeTab:      LibraryTab;
  mediaFilter:    MediaFilter;
  yearFilter:     number | null;
  sortBy:         SortBy;
  availableYears: number[];
  onApply:        (tab: LibraryTab, media: MediaFilter, year: number | null, sort: SortBy) => void;
  onClose:        () => void;
}) {
  const [localTab,   setLocalTab]   = useState(activeTab);
  const [localMedia, setLocalMedia] = useState(mediaFilter);
  const [localYear,  setLocalYear]  = useState(yearFilter);
  const [localSort,  setLocalSort]  = useState(sortBy);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-[1.75rem] border-t border-white/[0.08] bg-[#0d0d16] pb-safe-area-inset-bottom">
        {/* Handle */}
        <div className="flex justify-center py-3">
          <div className="h-1 w-10 rounded-full bg-white/[0.18]" />
        </div>

        <div className="px-5 pb-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-base font-black text-white">Filtrar e ordenar</h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/[0.10] p-1.5 text-white/50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Estado */}
          <SheetSection label="Estado">
            <div className="flex flex-wrap gap-2">
              {TAB_OPTIONS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLocalTab(tab.id)}
                  className={[
                    "rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition",
                    localTab === tab.id
                      ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-100"
                      : "border-white/[0.10] text-white/55 hover:bg-white/[0.07]",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </SheetSection>

          {/* Tipo */}
          <SheetSection label="Tipo">
            <div className="flex gap-2">
              {MEDIA_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLocalMedia(opt.id)}
                  className={[
                    "rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition",
                    localMedia === opt.id
                      ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-100"
                      : "border-white/[0.10] text-white/55 hover:bg-white/[0.07]",
                  ].join(" ")}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </SheetSection>

          {/* Ano */}
          {availableYears.length > 1 && (
            <SheetSection label="Ano">
              <select
                value={localYear?.toString() ?? "all"}
                onChange={(e) => setLocalYear(e.target.value === "all" ? null : parseInt(e.target.value, 10))}
                style={{ colorScheme: "dark" }}
                className="h-10 w-full appearance-none rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 text-sm text-white outline-none [&_option]:bg-[#0d0d14]"
              >
                <option value="all">Todos os anos</option>
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </SheetSection>
          )}

          {/* Ordenar por */}
          <SheetSection label="Ordenar por">
            <div className="flex flex-wrap gap-2">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setLocalSort(opt.value)}
                  className={[
                    "rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition",
                    localSort === opt.value
                      ? "border-indigo-400/40 bg-indigo-500/20 text-indigo-100"
                      : "border-white/[0.10] text-white/55 hover:bg-white/[0.07]",
                  ].join(" ")}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </SheetSection>

          {/* Actions */}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => {
                setLocalTab("all");
                setLocalMedia("all");
                setLocalYear(null);
                setLocalSort("popularity-desc");
              }}
              className="flex-1 rounded-2xl border border-white/[0.10] py-3 text-sm font-medium text-white/55 transition hover:bg-white/[0.06]"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => onApply(localTab, localMedia, localYear, localSort)}
              className="flex-1 rounded-2xl bg-indigo-500 py-3 text-sm font-black text-white transition hover:bg-indigo-400"
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function SheetSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-2.5 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
        {label}
      </p>
      {children}
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

function LibraryPagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page:         number;
  totalPages:   number;
  total:        number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) {
    return (
      <p className="text-center text-[11px] font-medium text-white/28">
        {total} {total === 1 ? "título" : "títulos"}
      </p>
    );
  }

  const pages = getPaginationPages(page, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      <p className="mr-1 hidden text-[11px] font-medium text-white/28 sm:block">
        {total} títulos
      </p>

      <button
        type="button"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        className="h-9 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-black text-white/45 transition hover:border-white/[0.15] hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
      >
        ‹
      </button>

      {pages.map((item, index) =>
        item === "gap" ? (
          <span key={`gap-${index}`} className="px-1 text-xs text-white/22">…</span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item)}
            className={[
              "h-9 min-w-9 rounded-full border px-3 text-xs font-black transition",
              item === page
                ? "border-indigo-300/28 bg-indigo-400/[0.14] text-indigo-50 shadow-[0_0_18px_rgba(99,102,241,0.16)]"
                : "border-white/[0.07] bg-white/[0.025] text-white/38 hover:border-white/[0.14] hover:text-white",
            ].join(" ")}
          >
            {item}
          </button>
        ),
      )}

      <button
        type="button"
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
        className="h-9 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-black text-white/45 transition hover:border-white/[0.15] hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
      >
        ›
      </button>
    </div>
  );
}

function getPaginationPages(page: number, total: number): Array<number | "gap"> {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const set    = new Set([1, total, page - 1, page, page + 1]);
  const sorted = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("gap");
    result.push(sorted[i]);
  }
  return result;
}

// ── Hook: responsive items per page ──────────────────────────────────────────

function useLibraryItemsPerPage() {
  const [itemsPerPage, setItemsPerPage] = useState(28);

  useEffect(() => {
    function update() {
      if (window.innerWidth < 640)  { setItemsPerPage(8);  return; }
      if (window.innerWidth < 1024) { setItemsPerPage(18); return; }
      setItemsPerPage(28);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return itemsPerPage;
}

// ── Hook: watchlist hydration ─────────────────────────────────────────────────

function useWatchlistHydration(library: Poplog3UserLibraryItem[], activeTab: string) {
  const router          = useRouter();
  const hydratingRef    = useRef(false);
  const sessionChecked  = useRef(false);
  const maxBatches      = 30;

  useEffect(() => {
    if (activeTab !== "watchlist") return;

    const hasTvWatchlist = library.some(
      (item) => item.media_type === "tv" && isPureWatchlist(item),
    );
    if (!hasTvWatchlist) return;
    if (sessionChecked.current) return;
    if (hydratingRef.current)   return;

    hydratingRef.current = true;

    async function runHydration() {
      try {
        let remaining = 1;
        let refreshNeeded = false;
        let previousRemaining: number | null = null;
        let batchCount = 0;

        while (remaining > 0 && batchCount < maxBatches) {
          batchCount++;
          const res = await fetch("/api/library/watchlist-hydrate", { method: "POST" });
          if (!res.ok) break;
          const data = await res.json() as {
            remaining?: number;
            hydrated?: number;
            durationBackfilled?: number;
            stopped?: boolean;
            reason?: string;
          };
          const nextRemaining = data.remaining ?? 0;
          if ((data.hydrated ?? 0) > 0 || (data.durationBackfilled ?? 0) > 0) {
            refreshNeeded = true;
          }

          if (data.stopped || (previousRemaining !== null && nextRemaining >= previousRemaining)) {
            remaining = nextRemaining;
            break;
          }

          previousRemaining = nextRemaining;
          remaining = nextRemaining;
          if (remaining > 0) await new Promise((r) => setTimeout(r, 500));
        }

        sessionChecked.current = true;
        if (refreshNeeded) router.refresh();
      } catch {
        // silent fail
      } finally {
        hydratingRef.current = false;
      }
    }

    void runHydration();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function sortLibraryItems(a: Poplog3UserLibraryItem, b: Poplog3UserLibraryItem, sortBy: SortBy) {
  switch (sortBy) {
    case "title-asc":      return getTitle(a).localeCompare(getTitle(b), "pt-BR");
    case "release-desc":   return getReleaseTime(b) - getReleaseTime(a);
    case "release-asc":    return getReleaseTime(a) - getReleaseTime(b);
    case "popularity-desc": return getPopularity(b) - getPopularity(a);
    case "runtime-asc":    return compareRuntime(a, b, "asc");
    case "runtime-desc":   return compareRuntime(a, b, "desc");
    case "recent":
    default:               return getAddedTime(b) - getAddedTime(a);
  }
}

function getTitle(item: Poplog3UserLibraryItem) {
  return item.title?.title ?? item.title?.original_title ?? "";
}

function getReleaseTime(item: Poplog3UserLibraryItem) {
  const t   = item.title;
  const now = Date.now();
  const date =
    item.media_type === "tv"
      ? t?.last_air_date ?? t?.first_air_date ?? t?.release_date
      : t?.release_date  ?? t?.first_air_date;
  if (!date) return 0;
  const time = new Date(date).getTime();
  if (!Number.isFinite(time) || time <= 0) return 0;
  return Math.min(time, now);
}

function compareRuntime(a: Poplog3UserLibraryItem, b: Poplog3UserLibraryItem, direction: "asc" | "desc") {
  const ar = getTotalRuntime(a);
  const br = getTotalRuntime(b);
  if (ar === null && br === null) return 0;
  if (ar === null) return 1;
  if (br === null) return -1;
  const delta = direction === "asc" ? ar - br : br - ar;
  return delta || getTitle(a).localeCompare(getTitle(b), "pt-BR");
}

function getTotalRuntime(item: Poplog3UserLibraryItem) {
  const candidates = [
    item.duration_sort_minutes,
    item.media_type === "tv" && item.watched_episodes && item.watched_episodes > 0
      ? item.remaining_runtime_minutes
      : item.total_runtime_minutes,
    item.remaining_runtime_minutes,
    item.title?.total_runtime_minutes,
    item.title?.runtime_minutes,
    item.title?.runtime,
  ];
  for (const r of candidates) {
    if (typeof r === "number" && Number.isFinite(r) && r >= 0) return r;
  }
  return null;
}

function getPopularity(item: Poplog3UserLibraryItem) {
  const p = item.title?.popularity;
  return typeof p === "number" ? p : 0;
}

function getAddedTime(item: Poplog3UserLibraryItem) {
  const date = item.updated_at ?? item.created_at ?? "";
  const time = new Date(date).getTime();
  return Number.isFinite(time) ? time : 0;
}

// ── Predicates ────────────────────────────────────────────────────────────────

function isUnreleased(item: Poplog3UserLibraryItem): boolean {
  const t    = item.title;
  const date = item.media_type === "tv"
    ? t?.first_air_date ?? t?.release_date
    : t?.release_date  ?? t?.first_air_date;
  if (!date) return false;
  const time = new Date(date).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function isInTheaterWindow(item: Poplog3UserLibraryItem): boolean {
  if (item.media_type !== "movie") return false;
  if (item.best_provider_logo || item.best_provider_name) return false;
  const releaseDate = item.title?.release_date;
  if (!releaseDate) return false;
  const releasedAt = new Date(releaseDate).getTime();
  if (!Number.isFinite(releasedAt)) return false;
  const now              = Date.now();
  const daysSinceRelease = (now - releasedAt) / (1000 * 60 * 60 * 24);
  return daysSinceRelease >= 0 && daysSinceRelease < THEATER_WINDOW_DAYS;
}

function isComingSoon(item: Poplog3UserLibraryItem): boolean {
  // Already available on a streaming platform — never "coming soon"
  if (item.best_provider_logo || item.best_provider_name || item.best_provider_type) return false;
  // High vote_average means the title has already been widely seen and rated
  if ((item.title?.vote_average ?? 0) >= 8.5) return false;
  return isUnreleased(item) || isInTheaterWindow(item);
}

function isMarathoning(item: Poplog3UserLibraryItem): boolean {
  if (item.media_type === "movie") return item.status === "watching";
  if (item.status !== "watching") return false;
  return (item.watched_episodes ?? 0) > 0 || item.computed_state === "in_progress";
}

function isCompletedOrUpToDate(item: Poplog3UserLibraryItem): boolean {
  if (item.media_type === "movie") return item.status === "watched";
  return (
    item.status === "watched" ||
    item.computed_state === "completed" ||
    item.computed_state === "up_to_date"
  );
}

function isPureWatchlist(item: Poplog3UserLibraryItem): boolean {
  return item.status === "watchlist" && (item.watched_episodes ?? 0) === 0;
}

function isValidLibraryTab(value?: string): value is LibraryTab {
  return [
    "watchlist", "favorites", "watching",
    "coming-soon", "watched", "all",
    "abandoned", "fridge",
  ].includes(value ?? "");
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}min`;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
}

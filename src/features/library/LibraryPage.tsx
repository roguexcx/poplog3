"use client";

import { useEffect, useMemo, useState } from "react";

import type { Poplog3UserLibraryItem } from "@/server/library/library-service";

import LibraryEmptyState from "./LibraryEmptyState";
import LibraryGrid from "./LibraryGrid";
import LibraryHero from "./LibraryHero";
import LibraryTabs, { LibraryTab } from "./LibraryTabs";

type LibraryPageProps = {
  library: Poplog3UserLibraryItem[];
  initialTab?: string;
};

type MediaFilter = "all" | "movie" | "tv";

type SortBy =
  | "release-desc"
  | "recent"
  | "title-asc"
  | "release-asc"
  | "rating-desc"
  | "runtime-asc"
  | "runtime-desc";

export default function LibraryPage({
  library,
  initialTab,
}: LibraryPageProps) {
  const [activeTab, setActiveTab] = useState<LibraryTab>(
    isValidLibraryTab(initialTab) ? initialTab : "all",
  );
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>(
    initialTab === "watchlist" ? "rating-desc" : "release-desc",
  );
  const [page, setPage] = useState(1);
  const itemsPerPage = useLibraryItemsPerPage();

  const stats = useMemo(() => {
    return {
      total: library.length,
      comingSoon: library.filter(isComingSoon).length,
      watched: library.filter((item) => item.status === "watched").length,
      watchlist: library.filter((item) => item.status === "watchlist").length,
      watching: library.filter((item) => item.status === "watching").length,
      betweenSeasons: library.filter(isBetweenSeasons).length,
      movies: library.filter((item) => item.media_type === "movie").length,
      series: library.filter((item) => item.media_type === "tv").length,
    };
  }, [library]);

  const filteredLibrary = useMemo(() => {
    let items = [...library];

    if (activeTab === "coming-soon") {
      items = items.filter(isComingSoon);
    } else if (activeTab === "between-seasons") {
      items = items.filter(isBetweenSeasons);
    } else if (activeTab !== "all") {
      items = items.filter((item) => item.status === activeTab);
    }

    if (mediaFilter !== "all") {
      items = items.filter((item) => item.media_type === mediaFilter);
    }

    items.sort((a, b) => sortLibraryItems(a, b, sortBy, activeTab));

    return items;
  }, [library, activeTab, mediaFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredLibrary.length / itemsPerPage));
  const safePage = Math.min(page, totalPages);

  const visibleLibrary = useMemo(() => {
    const start = (safePage - 1) * itemsPerPage;
    return filteredLibrary.slice(start, start + itemsPerPage);
  }, [filteredLibrary, safePage, itemsPerPage]);

  useEffect(() => {
    setPage(1);
  }, [itemsPerPage]);

  function resetPage() {
    setPage(1);
  }

  return (
    <main className="relative -mx-4 -mt-4 min-h-screen overflow-hidden bg-[#03040a] px-4 pb-12 pt-4 text-white sm:-mx-6 sm:px-6 md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-18%] top-[-12%] h-[36rem] w-[36rem] rounded-full bg-indigo-700/20 blur-[120px]" />
        <div className="absolute right-[-16%] top-[18rem] h-[34rem] w-[34rem] rounded-full bg-fuchsia-700/12 blur-[130px]" />
        <div className="absolute bottom-[-18%] left-[28%] h-[34rem] w-[34rem] rounded-full bg-cyan-700/10 blur-[140px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.035),transparent_22%,rgba(0,0,0,0.76)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,rgba(0,0,0,0.48)_68%,rgba(0,0,0,0.86)_100%)]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[1600px] flex-col gap-6 md:gap-8">
        <LibraryHero stats={stats} spotlightItems={library.slice(0, 8)} />

        <LibraryToolbar
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            resetPage();
          }}
          stats={stats}
          total={filteredLibrary.length}
          page={safePage}
          totalPages={totalPages}
          mediaFilter={mediaFilter}
          sortBy={sortBy}
          onMediaFilterChange={(filter) => {
            setMediaFilter(filter);
            resetPage();
          }}
          onSortChange={(sort) => {
            setSortBy(sort);
            resetPage();
          }}
          onPageChange={setPage}
        />

        <section className="relative pb-8">
          <div className="mb-5 flex flex-col gap-2 md:mb-7 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/34">
                Acervo filtrado
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-white md:text-4xl">
                {getSectionTitle(activeTab)}
              </h2>
            </div>

            <p className="max-w-xl text-sm leading-6 text-white/42 md:text-right">
              {getSectionDescription(activeTab)}
            </p>
          </div>

          {filteredLibrary.length === 0 ? (
            <LibraryEmptyState activeTab={activeTab} />
          ) : (
            <div className="flex flex-col gap-7 md:gap-8">
              <LibraryGrid items={visibleLibrary} />

              <div className="rounded-[2rem] border border-white/[0.07] bg-white/[0.025] px-4 py-4 backdrop-blur-xl">
                <LibraryPagination
                  page={safePage}
                  totalPages={totalPages}
                  total={filteredLibrary.length}
                  onPageChange={setPage}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

type LibraryToolbarProps = {
  activeTab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  stats: {
    total: number;
    comingSoon: number;
    watched: number;
    watchlist: number;
    watching: number;
    betweenSeasons: number;
  };
  total: number;
  page: number;
  totalPages: number;
  mediaFilter: MediaFilter;
  sortBy: SortBy;
  onMediaFilterChange: (filter: MediaFilter) => void;
  onSortChange: (sort: SortBy) => void;
  onPageChange: (page: number) => void;
};

function LibraryToolbar({
  activeTab,
  onTabChange,
  stats,
  total,
  page,
  totalPages,
  mediaFilter,
  sortBy,
  onMediaFilterChange,
  onSortChange,
  onPageChange,
}: LibraryToolbarProps) {
  return (
    <div className="sticky top-0 z-30 rounded-[1.75rem] border border-white/[0.08] bg-black/55 p-3 shadow-[0_24px_90px_rgba(0,0,0,0.45)] backdrop-blur-2xl md:p-4">
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />

      <div className="relative flex flex-col gap-3 md:gap-4">
        <LibraryTabs activeTab={activeTab} onChange={onTabChange} stats={stats} />

        <div className="grid gap-3 xl:grid-cols-[1fr_auto_1fr] xl:items-center">
          <div className="flex justify-center xl:justify-start">
            <div className="relative w-full max-w-[310px]">
              <select
                value={sortBy}
                onChange={(event) => onSortChange(event.target.value as SortBy)}
                style={{ colorScheme: "dark" }}
                className="h-11 w-full appearance-none rounded-full border border-white/[0.09] bg-white/[0.045] px-4 pr-10 text-center text-xs font-black uppercase tracking-[0.12em] text-white/78 outline-none transition hover:border-white/[0.18] focus:border-indigo-300/40 sm:text-left [&_option]:bg-[#020617] [&_option]:text-zinc-100"
              >
                <option value="release-desc">Lançamento recente</option>
                <option value="recent">Adicionados recentemente</option>
                <option value="title-asc">Nome A-Z</option>
                <option value="release-asc">Lançamento antigo</option>
                <option value="rating-desc">Melhor avaliação</option>
                <option value="runtime-asc">Mais curto</option>
                <option value="runtime-desc">Mais longo</option>
              </select>

              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/32">
                ↓
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <FilterButton active={mediaFilter === "all"} onClick={() => onMediaFilterChange("all")}>
              Tudo
            </FilterButton>
            <FilterButton active={mediaFilter === "movie"} onClick={() => onMediaFilterChange("movie")}>
              Filmes
            </FilterButton>
            <FilterButton active={mediaFilter === "tv"} onClick={() => onMediaFilterChange("tv")}>
              Séries
            </FilterButton>
          </div>

          <div className="hidden justify-end xl:flex">
            <LibraryPagination
              page={page}
              totalPages={totalPages}
              total={total}
              onPageChange={onPageChange}
              compact
            />
          </div>

          <div className="flex justify-center xl:hidden">
            <LibraryPagination
              page={page}
              totalPages={totalPages}
              total={total}
              onPageChange={onPageChange}
              compact
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function LibraryPagination({
  page,
  totalPages,
  total,
  onPageChange,
  compact = false,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  compact?: boolean;
}) {
  if (totalPages <= 1) {
    return (
      <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-white/36">
        {total} títulos
      </p>
    );
  }

  const pages = getPaginationPages(page, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {!compact && (
        <p className="mr-1 text-xs font-semibold uppercase tracking-[0.16em] text-white/36">
          {total} títulos
        </p>
      )}

      {compact && (
        <p className="hidden text-xs font-semibold uppercase tracking-[0.16em] text-white/34 sm:block">
          {total} títulos
        </p>
      )}

      <button
        type="button"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        className="h-9 rounded-full border border-white/[0.09] bg-white/[0.035] px-3 text-xs font-black text-white/54 transition hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
      >
        ‹
      </button>

      {pages.map((item, index) =>
        item === "gap" ? (
          <span key={`gap-${index}`} className="px-1 text-xs text-white/28">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item)}
            className={[
              "h-9 min-w-9 rounded-full border px-3 text-xs font-black transition",
              item === page
                ? "border-indigo-300/35 bg-indigo-400/[0.18] text-indigo-50 shadow-[0_0_28px_rgba(99,102,241,0.24)]"
                : "border-white/[0.09] bg-white/[0.035] text-white/46 hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-white",
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
        className="h-9 rounded-full border border-white/[0.09] bg-white/[0.035] px-3 text-xs font-black text-white/54 transition hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
      >
        ›
      </button>
    </div>
  );
}

function getPaginationPages(page: number, totalPages: number): Array<number | "gap"> {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);

  const sorted = [...pages]
    .filter((item) => item >= 1 && item <= totalPages)
    .sort((a, b) => a - b);

  const result: Array<number | "gap"> = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1];

    if (previous && current - previous > 1) {
      result.push("gap");
    }

    result.push(current);
  }

  return result;
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full border px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] transition duration-300",
        active
          ? "border-cyan-200/35 bg-cyan-300/[0.13] text-cyan-50 shadow-[0_0_28px_rgba(34,211,238,0.12)]"
          : "border-white/[0.08] bg-white/[0.03] text-white/42 hover:border-white/[0.16] hover:bg-white/[0.055] hover:text-white/76",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function getSectionTitle(activeTab: LibraryTab) {
  const titles: Record<LibraryTab, string> = {
    all: "Toda sua biblioteca",
    "coming-soon": "Títulos em breve",
    watchlist: "Sua watchlist",
    watching: "Em andamento",
    "between-seasons": "Entre temporadas",
    watched: "Histórico assistido",
    abandoned: "Abandonados",
    fridge: "Geladeira",
  };

  return titles[activeTab];
}

function getSectionDescription(activeTab: LibraryTab) {
  const descriptions: Record<LibraryTab, string> = {
    all: "A visão completa da sua coleção, com filmes e séries organizados por status, tempo, nota e momento.",
    "coming-soon": "Obras que ainda não chegaram, separadas para não misturar desejo com disponibilidade real.",
    watchlist: "Tudo que você salvou para ver depois, agora com cara de prateleira cinematográfica.",
    watching: "Títulos ativos que conversam diretamente com a lógica do Acompanhando.",
    "between-seasons": "Séries em pausa natural, sem tratar ausência de episódio como pendência urgente.",
    watched: "Seu histórico finalizado, preservado como memória da plataforma.",
    abandoned: "O que ficou pelo caminho sem poluir as áreas de continuidade.",
    fridge: "Títulos guardados para outro clima, longe da watchlist principal.",
  };

  return descriptions[activeTab];
}

function useLibraryItemsPerPage() {
  const [itemsPerPage, setItemsPerPage] = useState(28);

  useEffect(() => {
    function updateItemsPerPage() {
      if (window.innerWidth < 640) {
        setItemsPerPage(8);
        return;
      }

      if (window.innerWidth < 1024) {
        setItemsPerPage(18);
        return;
      }

      setItemsPerPage(28);
    }

    updateItemsPerPage();

    window.addEventListener("resize", updateItemsPerPage);

    return () => {
      window.removeEventListener("resize", updateItemsPerPage);
    };
  }, []);

  return itemsPerPage;
}

function sortLibraryItems(
  a: Poplog3UserLibraryItem,
  b: Poplog3UserLibraryItem,
  sortBy: SortBy,
  activeTab: LibraryTab,
) {
  if (sortBy === "release-desc" && activeTab !== "coming-soon") {
    const aComingSoon = isComingSoon(a);
    const bComingSoon = isComingSoon(b);

    if (aComingSoon !== bComingSoon) {
      return aComingSoon ? 1 : -1;
    }
  }

  switch (sortBy) {
    case "title-asc":
      return getTitle(a).localeCompare(getTitle(b), "pt-BR");

    case "release-desc":
      return getLibraryReleaseTime(b) - getLibraryReleaseTime(a);

    case "release-asc":
      return getLibraryReleaseTime(a) - getLibraryReleaseTime(b);

    case "rating-desc":
      return getRating(b) - getRating(a);

    case "runtime-asc":
      return getComparableRuntime(a) - getComparableRuntime(b);

    case "runtime-desc":
      return getComparableRuntime(b) - getComparableRuntime(a);

    case "recent":
    default:
      return getAddedTime(b) - getAddedTime(a);
  }
}

function getTitle(item: Poplog3UserLibraryItem) {
  return (
    item.title?.title ??
    item.title?.original_title ??
    `${item.media_type}/${item.tmdb_id}`
  );
}

function getLibraryReleaseTime(item: Poplog3UserLibraryItem) {
  const title = item.title;

  const date =
    item.media_type === "tv"
      ? title?.last_air_date ?? title?.first_air_date ?? title?.release_date
      : title?.release_date ?? title?.first_air_date;

  const time = date ? new Date(date).getTime() : 0;

  return Number.isFinite(time) ? time : 0;
}

function getFirstReleaseTime(item: Poplog3UserLibraryItem) {
  const title = item.title;

  const date =
    item.media_type === "tv"
      ? title?.first_air_date ?? title?.release_date
      : title?.release_date ?? title?.first_air_date;

  const time = date ? new Date(date).getTime() : 0;

  return Number.isFinite(time) ? time : 0;
}

function getLastAirTime(item: Poplog3UserLibraryItem) {
  const date = item.title?.last_air_date ?? null;
  const time = date ? new Date(date).getTime() : 0;

  return Number.isFinite(time) ? time : 0;
}

function getRating(item: Poplog3UserLibraryItem) {
  return typeof item.title?.vote_average === "number"
    ? item.title.vote_average
    : 0;
}

function getComparableRuntime(item: Poplog3UserLibraryItem) {
  const runtime =
    item.media_type === "tv"
      ? item.title?.episode_run_time?.find(
          (value) => typeof value === "number" && value > 0,
        ) ??
        item.title?.runtime ??
        0
      : item.title?.runtime ?? 0;

  return typeof runtime === "number" && Number.isFinite(runtime)
    ? runtime
    : Number.MAX_SAFE_INTEGER;
}

function getAddedTime(item: Poplog3UserLibraryItem) {
  const date = item.updated_at ?? item.created_at ?? "";
  const time = new Date(date).getTime();

  return Number.isFinite(time) ? time : 0;
}

function isComingSoon(item: Poplog3UserLibraryItem) {
  const releaseTime = getFirstReleaseTime(item);

  if (!releaseTime) {
    return false;
  }

  return releaseTime > Date.now();
}

function isBetweenSeasons(item: Poplog3UserLibraryItem) {
  if (item.status !== "watching" || item.media_type !== "tv") {
    return false;
  }

  const firstReleaseTime = getFirstReleaseTime(item);
  const lastAirTime = getLastAirTime(item);

  if (!firstReleaseTime || firstReleaseTime > Date.now()) {
    return false;
  }

  if (!lastAirTime) {
    return false;
  }

  return lastAirTime <= Date.now();
}

function isValidLibraryTab(value?: string): value is LibraryTab {
  return [
    "all",
    "coming-soon",
    "watchlist",
    "watching",
    "between-seasons",
    "watched",
    "abandoned",
    "fridge",
  ].includes(value ?? "");
}

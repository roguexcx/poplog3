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
  isValidLibraryTab(initialTab)
    ? initialTab
    : "all",
);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>(
  initialTab === "watchlist"
    ? "rating-desc"
    : "release-desc",
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
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 md:gap-8">
      <LibraryHero stats={stats} />

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

      <section className="pb-8">
        {filteredLibrary.length === 0 ? (
          <LibraryEmptyState activeTab={activeTab} />
        ) : (
          <div className="flex flex-col gap-7 md:gap-8">
            <LibraryGrid items={visibleLibrary} />

            <div className="border-t border-white/[0.06] pt-5 md:pt-6">
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
    <div className="sticky top-0 z-30 -mx-4 border-y border-white/[0.06] bg-[#020617]/86 px-4 py-3 backdrop-blur-2xl sm:-mx-6 sm:px-6 md:-mx-8 md:px-8 md:py-4 lg:-mx-10 lg:px-10">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 md:gap-4">
        <LibraryTabs activeTab={activeTab} onChange={onTabChange} stats={stats} />

        <div className="grid gap-3 xl:grid-cols-[1fr_auto_1fr] xl:items-center">
          <div className="flex justify-center xl:justify-start">
            <select
              value={sortBy}
              onChange={(event) => onSortChange(event.target.value as SortBy)}
              style={{ colorScheme: "dark" }}
              className="h-10 w-full max-w-[260px] appearance-none rounded-full border border-white/[0.1] bg-[#020617] px-4 text-center text-xs font-semibold text-zinc-100 outline-none transition hover:border-white/[0.18] focus:border-indigo-300/40 sm:text-left [&_option]:bg-[#020617] [&_option]:text-zinc-100"
            >
              <option value="release-desc">Lançamento mais recente</option>
              <option value="recent">Adicionados recentemente</option>
              <option value="title-asc">Nome A-Z</option>
              <option value="release-asc">Lançamento mais antigo</option>
              <option value="rating-desc">Melhor avaliação</option>
              <option value="runtime-asc">Mais curto</option>
              <option value="runtime-desc">Mais longo</option>
            </select>
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
    return <p className="text-center text-xs text-white/40">{total} títulos</p>;
  }

  const pages = getPaginationPages(page, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {!compact && <p className="mr-1 text-xs text-white/40">{total} títulos</p>}

      {compact && <p className="hidden text-xs text-white/40 sm:block">{total} títulos</p>}

      <button
        type="button"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        className="h-9 rounded-full border border-white/[0.09] bg-black/20 px-3 text-xs font-black text-white/54 transition hover:border-white/[0.18] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
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
                ? "border-indigo-300/35 bg-indigo-400/[0.16] text-indigo-100"
                : "border-white/[0.09] bg-black/20 text-white/46 hover:border-white/[0.18] hover:text-white",
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
        className="h-9 rounded-full border border-white/[0.09] bg-black/20 px-3 text-xs font-black text-white/54 transition hover:border-white/[0.18] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
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
        "rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.14em] transition duration-300",
        active
          ? "border-indigo-300/35 bg-indigo-400/[0.13] text-indigo-100"
          : "border-white/[0.08] bg-black/20 text-white/42 hover:border-white/[0.16] hover:text-white/76",
      ].join(" ")}
    >
      {children}
    </button>
  );
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

function isValidLibraryTab(
  value?: string,
): value is LibraryTab {
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
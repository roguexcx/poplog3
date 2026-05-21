"use client";

import { useEffect, useMemo, useState } from "react";

import SectionHeader from "@/components/ui/SectionHeader";
import type { Poplog3UserLibraryItem } from "@/server/library/library-service";

import LibraryEmptyState from "./LibraryEmptyState";
import LibraryGrid from "./LibraryGrid";
import LibraryHero from "./LibraryHero";
import LibraryTabs, { type LibraryTab } from "./LibraryTabs";

// ── Tipos ─────────────────────────────────────────────────────────────────────

type MediaFilter = "all" | "movie" | "tv";

type SortBy =
  | "release-desc"
  | "recent"
  | "title-asc"
  | "release-asc"
  | "popularity-desc"
  | "runtime-asc"
  | "runtime-desc";

type SortGroup = {
  /** Label exibido quando o chip está inativo */
  label:          string;
  /** Label exibido quando ativo na direção primária */
  primaryLabel:   string;
  /** Label exibido quando ativo na direção secundária (null = sem toggle) */
  secondaryLabel: string | null;
  primary:        SortBy;
  secondary:      SortBy | null;
};

const SORT_GROUPS: SortGroup[] = [
  {
    label: "Popularidade", primaryLabel: "Popularidade", secondaryLabel: null,
    primary: "popularity-desc", secondary: null,
  },
  {
    label: "Recente", primaryLabel: "Recente", secondaryLabel: null,
    primary: "recent", secondary: null,
  },
  {
    label: "Lançamento", primaryLabel: "Mais novo", secondaryLabel: "Mais antigo",
    primary: "release-desc", secondary: "release-asc",
  },
  {
    label: "A–Z", primaryLabel: "A–Z", secondaryLabel: null,
    primary: "title-asc", secondary: null,
  },
  {
    label: "Duração", primaryLabel: "Mais longo", secondaryLabel: "Mais curto",
    primary: "runtime-desc", secondary: "runtime-asc",
  },
];

const MEDIA_OPTIONS: { id: MediaFilter; label: string }[] = [
  { id: "all",   label: "Tudo"   },
  { id: "movie", label: "Filmes" },
  { id: "tv",    label: "Séries" },
];

/**
 * Janela de cinema: filmes lançados há menos de N dias sem provedor de streaming
 * são tratados como "indisponíveis em casa" e ficam apenas na aba "Em breve".
 */
const THEATER_WINDOW_DAYS = 45;

// ── Componente principal ──────────────────────────────────────────────────────

type LibraryPageProps = {
  library:     Poplog3UserLibraryItem[];
  initialTab?: string;
};

export default function LibraryPage({ library, initialTab }: LibraryPageProps) {
  const defaultTab: LibraryTab = isValidLibraryTab(initialTab) ? initialTab : "watchlist";
  const [activeTab,   setActiveTab]   = useState<LibraryTab>(defaultTab);
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [sortBy,      setSortBy]      = useState<SortBy>(
    defaultTab === "watchlist" ? "popularity-desc" : "release-desc",
  );
  const [page, setPage] = useState(1);
  const itemsPerPage    = useLibraryItemsPerPage();

  const stats = useMemo(() => ({
    total:      library.length,
    comingSoon: library.filter(isComingSoon).length,
    watched:    library.filter(isCompletedOrUpToDate).length,
    watchlist:  library.filter((i) => i.status === "watchlist" && !isComingSoon(i)).length,
    watching:   library.filter(isMarathoning).length,
    favorites:  library.filter((i) => i.favorite === true && !isComingSoon(i)).length,
  }), [library]);

  const filteredLibrary = useMemo(() => {
    let items = [...library];

    if (activeTab === "coming-soon") {
      // "Em breve" = não-lançados + filmes na janela de cinema (sem streaming ainda)
      items = items.filter(isComingSoon);
    } else {
      // Todas as outras abas: excluir títulos "em breve" (não-lançados ou janela de cinema)
      items = items.filter((i) => !isComingSoon(i));

      if (activeTab === "favorites") {
        items = items.filter((i) => i.favorite === true);
      } else if (activeTab === "watching") {
        items = items.filter(isMarathoning);
      } else if (activeTab === "watched") {
        items = items.filter(isCompletedOrUpToDate);
      } else if (activeTab !== "all") {
        items = items.filter((i) => i.status === activeTab);
      }
    }

    if (mediaFilter !== "all") {
      items = items.filter((i) => i.media_type === mediaFilter);
    }

    items.sort((a, b) => sortLibraryItems(a, b, sortBy, activeTab));
    return items;
  }, [library, activeTab, mediaFilter, sortBy]);

  const totalPages     = Math.max(1, Math.ceil(filteredLibrary.length / itemsPerPage));
  const safePage       = Math.min(page, totalPages);
  const visibleLibrary = useMemo(() => {
    const start = (safePage - 1) * itemsPerPage;
    return filteredLibrary.slice(start, start + itemsPerPage);
  }, [filteredLibrary, safePage, itemsPerPage]);

  useEffect(() => { setPage(1); }, [activeTab, mediaFilter, sortBy, itemsPerPage]);

  return (
    <div className="relative flex flex-col gap-10 md:gap-14">

      {/* Atmospheric depth */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-48 top-[20%] h-[600px] w-[600px] rounded-full bg-indigo-700/[0.05] blur-[130px]" />
        <div className="absolute -right-40 top-[55%] h-[500px] w-[500px] rounded-full bg-violet-600/[0.04] blur-[110px]" />
        <div className="absolute left-1/3 top-[5%] h-[350px] w-[350px] rounded-full bg-cyan-600/[0.03] blur-[90px]" />
      </div>

      {/* Hero */}
      <LibraryHero stats={stats} spotlightItems={library.slice(0, 8)} />

      {/* Sticky toolbar */}
      <LibraryToolbar
        activeTab={activeTab}
        onTabChange={(tab) => { setActiveTab(tab); setPage(1); }}
        stats={stats}
        total={filteredLibrary.length}
        mediaFilter={mediaFilter}
        sortBy={sortBy}
        onMediaFilterChange={(f) => { setMediaFilter(f); setPage(1); }}
        onSortChange={(s) => { setSortBy(s); setPage(1); }}
      />

      {/* Conteúdo */}
      <section className="relative pb-12">
        <SectionHeader
          eyebrow="Acervo filtrado"
          accent="indigo"
          title={getSectionTitle(activeTab)}
          subtitle={getSectionDescription(activeTab)}
          size="md"
          action={
            <span className="rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1 text-[11px] font-bold text-white/50">
              {filteredLibrary.length}{" "}
              {filteredLibrary.length === 1 ? "título" : "títulos"}
            </span>
          }
          className="mb-8"
        />

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
    </div>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

type LibraryToolbarProps = {
  activeTab:           LibraryTab;
  onTabChange:         (tab: LibraryTab) => void;
  stats: {
    total:      number;
    comingSoon: number;
    watched:    number;
    watchlist:  number;
    watching:   number;
    favorites:  number;
  };
  total:               number;
  mediaFilter:         MediaFilter;
  sortBy:              SortBy;
  onMediaFilterChange: (f: MediaFilter) => void;
  onSortChange:        (s: SortBy) => void;
};

function LibraryToolbar({
  activeTab, onTabChange, stats,
  total, mediaFilter, sortBy,
  onMediaFilterChange, onSortChange,
}: LibraryToolbarProps) {
  return (
    <div className="sticky top-0 z-30 bg-[rgba(13,13,20,0.88)] backdrop-blur-xl">
      <div className="absolute inset-x-0 top-0 h-px bg-white/[0.06]" />
      <LibraryTabs activeTab={activeTab} onChange={onTabChange} stats={stats} />
      <LibraryFilterBar
        mediaFilter={mediaFilter}
        sortBy={sortBy}
        total={total}
        onMediaFilterChange={onMediaFilterChange}
        onSortChange={onSortChange}
      />
      <div className="absolute inset-x-0 bottom-0 h-px bg-white/[0.05]" />
    </div>
  );
}

// ── Barra de filtros — centralizada ──────────────────────────────────────────

function LibraryFilterBar({
  mediaFilter, sortBy, total, onMediaFilterChange, onSortChange,
}: {
  mediaFilter:         MediaFilter;
  sortBy:              SortBy;
  total:               number;
  onMediaFilterChange: (f: MediaFilter) => void;
  onSortChange:        (s: SortBy) => void;
}) {
  return (
    <div className="relative h-11 overflow-hidden border-t border-white/[0.05] bg-white/[0.02]">

      {/* Pills centralizadas — scrollável quando necessário */}
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-0 overflow-x-auto no-scrollbar px-3 sm:px-4">

          {/* Grupo 1: tipo de mídia */}
          {MEDIA_OPTIONS.map((opt, i) => (
            <div key={opt.id} className="flex items-center">
              {i > 0 && (
                <span className="mx-1.5 select-none text-[10px] text-white/[0.18]">|</span>
              )}
              <FilterPill
                active={mediaFilter === opt.id}
                onClick={() => onMediaFilterChange(opt.id)}
              >
                {opt.label}
              </FilterPill>
            </div>
          ))}

          {/* Divisor entre grupos */}
          <div className="mx-3 h-4 w-px shrink-0 bg-white/[0.12]" />

          {/* Grupo 2: ordenação */}
          {SORT_GROUPS.map((group) => (
            <div key={group.label} className="mr-1.5 last:mr-0">
              <SortPill group={group} value={sortBy} onChange={onSortChange} />
            </div>
          ))}
        </div>
      </div>

      {/* Contagem — absolutamente à direita, não perturba o centramento */}
      <div className="absolute right-3 top-0 flex h-full items-center sm:right-4">
        <p className="text-[12px] text-white/[0.35]">
          {total} {total === 1 ? "título" : "títulos"}
        </p>
      </div>

    </div>
  );
}

// ── Pill de tipo de mídia ─────────────────────────────────────────────────────

function FilterPill({
  active,
  onClick,
  children,
}: {
  active:   boolean;
  onClick:  () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full px-[14px] py-[5px] text-[12px] font-medium transition duration-150",
        active
          ? "bg-white text-black"
          : "border border-white/[0.10] text-white/50 hover:bg-white/[0.07] hover:text-white/75",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// ── Pill de ordenação ─────────────────────────────────────────────────────────

function SortPill({
  group,
  value,
  onChange,
}: {
  group:    SortGroup;
  value:    SortBy;
  onChange: (s: SortBy) => void;
}) {
  const isPrimary   = value === group.primary;
  const isSecondary = group.secondary !== null && value === group.secondary;
  const isActive    = isPrimary || isSecondary;
  const hasToggle   = group.secondary !== null;

  function handleClick() {
    if (!isActive)               return onChange(group.primary);
    if (isPrimary && hasToggle)  return onChange(group.secondary!);
    onChange(group.primary); // secondary → volta ao primary
  }

  const displayLabel = !isActive
    ? group.label
    : isPrimary
      ? group.primaryLabel
      : (group.secondaryLabel ?? group.label);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={[
        "rounded-full px-[14px] py-[5px] text-[12px] font-medium transition duration-150",
        isActive
          ? "bg-white text-black"
          : "border border-white/[0.10] text-white/50 hover:bg-white/[0.07] hover:text-white/75",
      ].join(" ")}
    >
      {displayLabel}
    </button>
  );
}

// ── Paginação ─────────────────────────────────────────────────────────────────

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

// ── Textos de seção ───────────────────────────────────────────────────────────

function getSectionTitle(tab: LibraryTab) {
  const map: Record<LibraryTab, string> = {
    watchlist:     "Sua watchlist",
    favorites:     "Seus favoritos",
    watching:      "Em andamento",
    "coming-soon": "Em breve",
    watched:       "Histórico assistido",
    all:           "Toda sua biblioteca",
    abandoned:     "Abandonados",
    fridge:        "Geladeira",
  };
  return map[tab];
}

function getSectionDescription(tab: LibraryTab) {
  const map: Record<LibraryTab, string> = {
    watchlist:     "Tudo que você salvou e já está disponível para assistir.",
    favorites:     "Os títulos que marcaram — filmes e séries que você destacou como favoritos.",
    watching:      "Títulos ativos que conversam diretamente com a lógica do Acompanhando.",
    "coming-soon": "Não lançados ainda ou ainda em cartaz nos cinemas — indisponíveis em casa por enquanto.",
    watched:       "Seu histórico finalizado, preservado como memória da plataforma.",
    all:           "Toda sua coleção disponível para assistir — excluindo títulos ainda indisponíveis em casa.",
    abandoned:     "O que ficou pelo caminho sem poluir as áreas de continuidade.",
    fridge:        "Títulos guardados para outro clima, longe da watchlist principal.",
  };
  return map[tab];
}

// ── Hook responsivo ───────────────────────────────────────────────────────────

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

// ── Funções de ordenação ──────────────────────────────────────────────────────

function sortLibraryItems(
  a:         Poplog3UserLibraryItem,
  b:         Poplog3UserLibraryItem,
  sortBy:    SortBy,
  activeTab: LibraryTab,
) {
  switch (sortBy) {
    case "title-asc":
      return getTitle(a).localeCompare(getTitle(b), "pt-BR");
    case "release-desc":
      return getReleaseTime(b) - getReleaseTime(a);
    case "release-asc":
      return getReleaseTime(a) - getReleaseTime(b);
    case "popularity-desc":
      return getPopularity(b) - getPopularity(a);
    case "runtime-asc":
      return compareRuntime(a, b, "asc");
    case "runtime-desc":
      return compareRuntime(a, b, "desc");
    case "recent":
    default:
      return getAddedTime(b) - getAddedTime(a);
  }
}

function getTitle(item: Poplog3UserLibraryItem) {
  return item.title?.title ?? item.title?.original_title ?? "";
}

/**
 * Data de referência para "Mais novo / Mais antigo":
 * - Série:  last_air_date — populado no service a partir de poplog3_episodes
 *           (apenas episódios com air_date <= hoje, regra global).
 *           Fallback: first_air_date → release_date.
 * - Filme:  release_date → first_air_date.
 *
 * Sempre limitado a hoje (Math.min): TMDB pode ter datas futuras para episódios
 * pré-cadastrados; não deixamos isso inflacionar o rank de "mais recente".
 */
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

  // Nunca ordenar por data futura — séries em andamento devem aparecer como "hoje"
  return Math.min(time, now);
}

/**
 * Duração usada pelo filtro (minutos):
 * - Filme: runtime oficial
 * - Série: tempo restante para este usuário concluir a série
 *
 * Se a série ainda não começou, remaining_runtime_minutes equivale à previsão
 * total. Itens sem dado ficam sempre no fim, tanto em Tudo quanto nas abas.
 */
function compareRuntime(
  a: Poplog3UserLibraryItem,
  b: Poplog3UserLibraryItem,
  direction: "asc" | "desc",
) {
  const aRuntime = getTotalRuntime(a);
  const bRuntime = getTotalRuntime(b);

  if (aRuntime === null && bRuntime === null) return 0;
  if (aRuntime === null) return 1;
  if (bRuntime === null) return -1;

  const delta = direction === "asc" ? aRuntime - bRuntime : bRuntime - aRuntime;

  return delta || getTitle(a).localeCompare(getTitle(b), "pt-BR");
}

function getTotalRuntime(item: Poplog3UserLibraryItem) {
  const runtime = item.duration_sort_minutes;
  return typeof runtime === "number" && Number.isFinite(runtime) && runtime >= 0
    ? runtime
    : null;
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

// ── Predicados de disponibilidade ─────────────────────────────────────────────

/**
 * Título ainda não lançado (data de estreia no futuro).
 */
function isUnreleased(item: Poplog3UserLibraryItem): boolean {
  const t    = item.title;
  const date =
    item.media_type === "tv"
      ? t?.first_air_date ?? t?.release_date
      : t?.release_date ?? t?.first_air_date;
  if (!date) return false;
  const time = new Date(date).getTime();
  return Number.isFinite(time) && time > Date.now();
}

/**
 * Filme dentro da janela de cinema:
 * lançado há menos de THEATER_WINDOW_DAYS dias E sem provedor de streaming detectado.
 * Indica que o filme provavelmente ainda está em cartaz e indisponível em casa.
 */
function isInTheaterWindow(item: Poplog3UserLibraryItem): boolean {
  if (item.media_type !== "movie") return false;
  // Se já tem provedor de streaming, saiu da janela de cinema
  if (item.best_provider_logo || item.best_provider_name) return false;
  const releaseDate = item.title?.release_date;
  if (!releaseDate) return false;
  const releasedAt = new Date(releaseDate).getTime();
  if (!Number.isFinite(releasedAt)) return false;
  const now              = Date.now();
  const daysSinceRelease = (now - releasedAt) / (1000 * 60 * 60 * 24);
  // Entre 0 e THEATER_WINDOW_DAYS dias atrás
  return daysSinceRelease >= 0 && daysSinceRelease < THEATER_WINDOW_DAYS;
}

/**
 * Título "em breve" = não lançado ainda OU filme na janela de cinema.
 * Estes títulos aparecem APENAS na aba "Em breve" — ficam ocultos nas demais.
 */
function isComingSoon(item: Poplog3UserLibraryItem): boolean {
  return isUnreleased(item) || isInTheaterWindow(item);
}

function isMarathoning(item: Poplog3UserLibraryItem): boolean {
  if (item.media_type === "movie") {
    return item.status === "watching";
  }

  return (
    item.status === "watching" &&
    item.computed_state === "in_progress" &&
    typeof item.remaining_runtime_minutes === "number" &&
    item.remaining_runtime_minutes > 0
  );
}

function isCompletedOrUpToDate(item: Poplog3UserLibraryItem): boolean {
  if (item.media_type === "movie") {
    return item.status === "watched";
  }

  return (
    item.status === "watched" ||
    item.computed_state === "completed" ||
    item.computed_state === "up_to_date"
  );
}

function isValidLibraryTab(value?: string): value is LibraryTab {
  return [
    "watchlist", "favorites", "watching",
    "coming-soon", "watched", "all",
    "abandoned", "fridge",
  ].includes(value ?? "");
}

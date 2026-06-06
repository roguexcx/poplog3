"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Film, Search, Sparkles, Tv, UserRound, X } from "lucide-react";

import PageShell from "@/components/layout/PageShell";
import InteractivePosterCard from "@/components/ui/InteractivePosterCard";
import EmptyState from "@/components/ui/EmptyState";
import SectionHeader from "@/components/ui/SectionHeader";
import ExploreShortcuts from "./ExploreShortcuts";
import { findShortcut } from "@/lib/discovery/shortcuts-config";
import { resolveCatalogImage } from "@/lib/images/resolve";

type SearchMediaType = "all" | "movie" | "tv";

type ShortcutResultResponse = {
  ok: boolean;
  slug: string;
  title: string;
  displayTitle?: string;
  description: string;
  popularMovies?: SearchResult[];
  popularSeries?: SearchResult[];
  results: SearchResult[];
  fallbackUsed?: boolean;
  source?: string;
  debug?: {
    slugs: string[];
    beforeFilter: number;
    afterFilter: number;
    fallbackItems: number;
    mediaTypeFilter?: string;
  };
};

type SearchResult = {
  tmdb_id: number;
  poplogId?: string | number | null;
  externalIds?: {
    tmdbId?: number;
    imdbId?: string;
    tvdbId?: number;
    traktId?: number | string;
    balloonerismmId?: string;
    slug?: string;
  };
  identityUsed?: string;
  linkIdUsed?: string | number;
  hasPoplogId?: boolean;
  media_type: "movie" | "tv";
  title: string;
  original_title?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number | null;
  overview?: string | null;
};

type SearchPerson = {
  tmdb_id: number;
  name: string;
  profile_path: string | null;
  known_for_department: string | null;
  popularity: number;
  known_for: SearchResult[];
  href: string;
};

type SearchResponse = {
  ok: boolean;
  query: string;
  type: SearchMediaType;
  page: number;
  totalPages: number;
  totalResults: number;
  count: number;
  peopleCount?: number;
  results: SearchResult[];
  people?: SearchPerson[];
};

type DiscoveryResponse = {
  ok: boolean;
  trending: SearchResult[];
  popularMovies: SearchResult[];
  popularSeries: SearchResult[];
};

type SearchPageViewProps = {
  initialQuery: string;
  initialType: string;
  initialPage: number;
  initialShortcut?: string;
};

type SearchMeta = {
  page: number;
  totalPages: number;
  totalResults: number;
  count: number;
};

const SEARCH_DEBOUNCE_MS = 300;

function normalizeMediaType(value: string): SearchMediaType {
  return value === "movie" || value === "tv" ? value : "all";
}

function normalizePage(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function getYear(title: SearchResult) {
  const date = title.release_date ?? title.first_air_date;
  if (!date) return undefined;
  const year = new Date(date).getFullYear();
  return Number.isFinite(year) ? year : undefined;
}

function imageUrl(path: string | null | undefined, size = "w185") {
  return resolveCatalogImage(path, size);
}

function titleLinkId(title: SearchResult) {
  return title.linkIdUsed ?? title.poplogId ?? title.externalIds?.imdbId ?? title.externalIds?.balloonerismmId ?? title.tmdb_id;
}

function SectionDivider() {
  return (
    <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
  );
}

function TitleGrid({ titles }: { titles: SearchResult[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4 lg:grid-cols-6">
      {titles.map((title, index) => (
        <InteractivePosterCard
          key={`${title.media_type}-${title.tmdb_id}`}
          id={title.tmdb_id}
          poplogId={title.poplogId ?? null}
          imdbId={title.externalIds?.imdbId ?? null}
          slug={title.externalIds?.slug ?? null}
          href={`/title/${title.media_type}/${titleLinkId(title)}`}
          mediaType={title.media_type}
          title={title.title}
          originalTitle={title.original_title ?? null}
          posterPath={title.poster_path}
          fallbackPath={title.backdrop_path}
          year={getYear(title)}
          source="search"
          priority={index < 2}
        />
      ))}
    </div>
  );
}

function PeopleGrid({ people }: { people: SearchPerson[] }) {
  if (!people.length) return null;
  return (
    <section className="space-y-5">
      <SectionHeader
        eyebrow="Pessoas"
        title="Pessoas encontradas"
        subtitle="Atores, diretores e criadores relacionados à busca."
        accent="indigo"
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {people.map((person) => {
          const profileUrl = imageUrl(person.profile_path);
          const knownFor = person.known_for
            .map((t) => t.title)
            .filter(Boolean)
            .slice(0, 3)
            .join(", ");
          return (
            <Link
              key={person.tmdb_id}
              href={person.href}
              className="group flex gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3 transition hover:-translate-y-0.5 hover:bg-white/[0.045] hover:border-white/[0.12]"
            >
              <div className="relative flex size-[68px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.06]">
                {profileUrl ? (
                  <Image src={profileUrl} alt={person.name} fill sizes="68px" className="object-cover transition duration-500 group-hover:scale-105" />
                ) : (
                  <UserRound className="size-6 text-white/35" />
                )}
              </div>
              <div className="min-w-0 py-1">
                <p className="truncate text-[13px] font-bold tracking-[-0.01em] text-white/90">{person.name}</p>
                <p className="mt-0.5 text-[11px] text-white/40">{person.known_for_department ?? "Cinema e TV"}</p>
                {knownFor ? (
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-white/35">Conhecido por {knownFor}</p>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default function SearchPageView({ initialQuery, initialType, initialPage, initialShortcut = "" }: SearchPageViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState<SearchMediaType>(normalizeMediaType(initialType));
  const [page, setPage] = useState(() => normalizePage(initialPage));
  const [selectedShortcut, setSelectedShortcut] = useState(initialShortcut);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [people, setPeople] = useState<SearchPerson[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchMeta, setSearchMeta] = useState<SearchMeta | null>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
  const [shortcutLoading, setShortcutLoading] = useState(false);
  const [shortcutData, setShortcutData] = useState<ShortcutResultResponse | null>(null);

  useEffect(() => {
    setQuery(initialQuery);
    setType(normalizeMediaType(initialType));
    setPage(normalizePage(initialPage));
    setSelectedShortcut(initialShortcut ?? "");
  }, [initialQuery, initialType, initialPage, initialShortcut]);

  const trimmedQuery = useMemo(() => query.trim(), [query]);
  const maxSearchPage = Math.max(1, Math.min(searchMeta?.totalPages ?? page, 500));
  const searchSubtitle = useMemo(() => {
    if (!searchMeta) return `${results.length} títulos encontrados`;
    const total = searchMeta.totalResults.toLocaleString("pt-BR");
    const pageText = searchMeta.totalPages > 1 ? ` - pagina ${searchMeta.page} de ${searchMeta.totalPages}` : "";
    return `${total} resultados${pageText}`;
  }, [results.length, searchMeta]);
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (type !== "all") count += 1;
    if (selectedShortcut) count += 1;
    return count;
  }, [type, selectedShortcut]);

  function handleQueryChange(value: string) {
    setQuery(value);
    setPage(1);
  }

  function handleTypeChange(nextType: SearchMediaType) {
    setType(nextType);
    setPage(1);
  }

  function handleShortcutSelect(slug: string) {
    setSelectedShortcut((current) => current === slug ? "" : slug);
    setPage(1);
  }

  function clearFilters() {
    setType("all");
    setSelectedShortcut("");
    setPage(1);
  }

  useEffect(() => {
    const timeout = setTimeout(() => {
      const params = new URLSearchParams();

      if (trimmedQuery) params.set("q", trimmedQuery);
      if (type !== "all") params.set("type", type);
      if (trimmedQuery && page > 1) params.set("page", String(page));
      if (!trimmedQuery && selectedShortcut) params.set("atalho", selectedShortcut);

      const queryString = params.toString();
      const nextUrl = queryString ? `${pathname}?${queryString}` : pathname;
      const currentUrl = `${window.location.pathname}${window.location.search}`;

      if (currentUrl !== nextUrl) {
        router.replace(nextUrl, { scroll: false });
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [page, pathname, router, selectedShortcut, trimmedQuery, type]);

  useEffect(() => {
    if (trimmedQuery || selectedShortcut || discovery) return;
    const controller = new AbortController();
    async function load() {
      try {
        setDiscoveryLoading(true);
        const res = await fetch("/api/poplog3/search/discovery", { signal: controller.signal });
        const data: DiscoveryResponse = await res.json();
        if (data.ok) setDiscovery(data);
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.error("[discovery]", e);
      } finally {
        setDiscoveryLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [trimmedQuery, selectedShortcut, discovery]);

  useEffect(() => {
    if (trimmedQuery || !selectedShortcut) { setShortcutData(null); return; }
    const controller = new AbortController();
    async function load() {
      try {
        setShortcutLoading(true);
        const params = new URLSearchParams({ type });
        const res = await fetch(`/api/poplog3/discovery/shortcut/${encodeURIComponent(selectedShortcut)}?${params}`, { signal: controller.signal });
        const data: ShortcutResultResponse = await res.json();
        if (data.ok) setShortcutData(data);
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.error("[shortcut-discover]", e);
      } finally {
        setShortcutLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [trimmedQuery, selectedShortcut]);

  useEffect(() => {
    if (!trimmedQuery) {
      setResults([]);
      setPeople([]);
      setHasSearched(false);
      setSearchError(null);
      setSearchMeta(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        setLoading(true);
        setSearchError(null);
        const params = new URLSearchParams({ q: trimmedQuery, type, page: String(page) });
        const res = await fetch(`/api/poplog3/search?${params}`, { signal: controller.signal });
        const data: SearchResponse = await res.json();
        if (!res.ok || !data.ok) {
          setResults([]);
          setPeople([]);
          setSearchMeta(null);
          setSearchError("Nao foi possivel carregar a busca agora. Tente novamente em instantes.");
          setHasSearched(true);
          return;
        }
        setResults(data.results ?? []);
        setPeople(data.people ?? []);
        setSearchMeta({
          page: data.page ?? page,
          totalPages: Math.max(1, data.totalPages ?? 1),
          totalResults: data.totalResults ?? data.count ?? 0,
          count: data.count ?? data.results?.length ?? 0,
        });
        setHasSearched(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          console.error("[search]", e);
          setResults([]);
          setPeople([]);
          setSearchMeta(null);
          setSearchError("Nao foi possivel carregar a busca agora. Tente novamente em instantes.");
          setHasSearched(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [page, trimmedQuery, type]);

  return (
    <PageShell variant="wide">
      <div className="flex flex-col gap-6 py-4 pb-2 sm:gap-8 sm:py-6 sm:pb-8">
        <div className="pointer-events-none fixed inset-x-0 top-0 z-30 h-44 bg-gradient-to-b from-[#060719] via-[#060719]/82 to-transparent sm:h-52" />

        {/* Header */}
        <section className="sticky top-3 z-40 overflow-hidden rounded-[1.15rem] border border-white/[0.09] bg-[#080b1d]/88 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.34)] backdrop-blur-2xl sm:top-4 sm:rounded-[1.75rem] sm:p-6 md:p-8 lg:rounded-[2rem] lg:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(129,140,248,0.18),transparent_34%),radial-gradient(circle_at_88%_20%,rgba(6,182,212,0.10),transparent_30%)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          <div className="relative grid gap-4 sm:gap-6 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
            <div className="hidden sm:order-1 sm:block">
              <div className="mb-3 hidden items-center gap-2 sm:flex md:mb-5">
                <span className="h-px w-5 rounded-full bg-indigo-300/80 sm:w-8" />
                <span className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-indigo-200/80">Buscar &amp; Explorar</span>
              </div>
              <h1 className="text-xl font-black tracking-[-0.04em] text-white sm:text-4xl md:text-5xl lg:text-[3.25rem]">Encontre qualquer coisa.</h1>
              <p className="mt-1.5 max-w-xl text-xs leading-5 text-white/45 sm:mt-3 sm:text-sm md:mt-4 md:text-base md:leading-7">
                {"Títulos, pessoas, gêneros e tendências da semana."}
              </p>
            </div>
            <div className="order-1 flex flex-col gap-2.5 sm:order-2 sm:gap-3">
              <div className="flex items-center gap-2 sm:hidden">
                <span className="h-px w-6 rounded-full bg-indigo-300/80" />
                <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-indigo-200/80">Buscar &amp; Explorar</span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/35" />
                <input
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  placeholder={"Título, pessoa, saga ou universo..."}
                  className="h-11 w-full rounded-2xl border border-white/[0.08] bg-black/30 pl-11 pr-4 text-sm font-medium text-white outline-none transition placeholder:text-white/30 focus:border-indigo-400/40 focus:bg-black/40 sm:h-12"
                />
              </div>
              <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                {([
                  { value: "all", label: "Todos", icon: Sparkles },
                  { value: "movie", label: "Filmes", icon: Film },
                  { value: "tv", label: "Séries", icon: Tv },
                ] as const).map((item) => {
                  const Icon = item.icon;
                  const active = type === item.value;
                  return (
                    <button key={item.value} onClick={() => handleTypeChange(item.value)}
                      className={`flex items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.10em] transition sm:justify-start sm:px-4 sm:text-[11px] sm:tracking-[0.12em] ${active ? "border-indigo-300/35 bg-indigo-400/[0.13] text-indigo-100" : "border-white/[0.08] bg-white/[0.035] text-white/55 hover:bg-white/[0.07] hover:text-white/80"}`}>
                      <Icon className="size-3.5" />{item.label}
                    </button>
                  );
                })}
                {activeFiltersCount > 0 && (
                  <button onClick={clearFilters}
                    className="col-span-3 flex items-center justify-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.035] px-3.5 py-2 text-[10px] font-black uppercase tracking-[0.10em] text-white/45 transition hover:bg-white/[0.07] hover:text-white/70 sm:col-auto sm:text-[11px] sm:tracking-[0.12em]">
                    <X className="size-3" />Limpar
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Explore por vibe — always visible when no active search query */}
        {!trimmedQuery ? (
          <ExploreShortcuts activeSlug={selectedShortcut} onSelect={handleShortcutSelect} />
        ) : null}

        {/* Skeleton — initial load */}
        {(loading || shortcutLoading || discoveryLoading) && !hasSearched ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] animate-pulse rounded-[1.35rem] border border-white/[0.06] bg-white/[0.04]" />
            ))}
          </div>
        ) : null}

        {loading && hasSearched ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-sm font-medium text-white/55">
            Atualizando resultados...
          </div>
        ) : null}

        {searchError && hasSearched ? (
          <EmptyState kicker="Erro na busca" title="Busca indisponivel." description={searchError} accent="neutral" />
        ) : null}

        {/* People results */}
        {!searchError && !loading && hasSearched && people.length > 0 ? <PeopleGrid people={people} /> : null}

        {/* Title results */}
        {!searchError && !loading && hasSearched && results.length > 0 ? (
          <section className="space-y-5">
            <SectionHeader
              eyebrow="Resultados"
              title="Títulos encontrados"
              subtitle={searchSubtitle}
              accent="indigo"
            />
            <TitleGrid titles={results} />
            {searchMeta && searchMeta.totalPages > 1 ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-semibold text-white/45">
                  Pagina {searchMeta.page} de {searchMeta.totalPages}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={page <= 1}
                    className="flex items-center justify-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white/55 transition hover:bg-white/[0.07] hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronLeft className="size-3.5" />
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((value) => Math.min(maxSearchPage, value + 1))}
                    disabled={page >= maxSearchPage}
                    className="flex items-center justify-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white/55 transition hover:bg-white/[0.07] hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    Proxima
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Empty search */}
        {!searchError && !loading && hasSearched && results.length === 0 && people.length === 0 ? (
          <EmptyState kicker="Busca vazia" title="Nenhum resultado encontrado." description="Tente outro termo, tipo ou vibe." accent="neutral" />
        ) : null}

        {/* Shortcut results */}
        {!trimmedQuery && selectedShortcut && !shortcutLoading && shortcutData ? (() => {
          const sc = findShortcut(selectedShortcut);
          const eyebrow = sc?.group.label ?? "Descoberta";
          const displayTitle = shortcutData.displayTitle ?? shortcutData.title;
          const hasMovies = (shortcutData.popularMovies?.length ?? 0) > 0;
          const hasSeries = (shortcutData.popularSeries?.length ?? 0) > 0;
          const d = shortcutData.debug;
          return (
            <div className="flex flex-col gap-10">
              {/* Debug log (console only) */}
              {d ? (() => { console.log(`[search/shortcut] slug=${selectedShortcut} type=${type} source=${shortcutData.source} before=${d.beforeFilter} after=${d.afterFilter} fallback=${shortcutData.fallbackUsed} fallbackItems=${d.fallbackItems} slugs=${d.slugs?.join(",")}`); return null; })() : null}

              {/* Fallback notice */}
              {shortcutData.fallbackUsed ? (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-2.5 text-[11px] font-medium text-amber-200/70">
                  Resultado ampliado com títulos populares do gênero — índice Trakt retornou poucos itens para &quot;{shortcutData.title}&quot; nesta janela.
                </div>
              ) : null}

              {hasMovies ? (
                <section className="space-y-5">
                  <SectionHeader
                    eyebrow={eyebrow}
                    title={hasSeries ? `Filmes — ${displayTitle}` : displayTitle}
                    subtitle={shortcutData.description}
                    accent="indigo"
                  />
                  <TitleGrid titles={shortcutData.popularMovies!} />
                </section>
              ) : null}
              {hasMovies && hasSeries ? <SectionDivider /> : null}
              {hasSeries ? (
                <section className="space-y-5">
                  <SectionHeader
                    eyebrow={eyebrow}
                    title={hasMovies ? `Séries — ${displayTitle}` : displayTitle}
                    subtitle={hasMovies ? "" : shortcutData.description}
                    accent="indigo"
                  />
                  <TitleGrid titles={shortcutData.popularSeries!} />
                </section>
              ) : null}
              {!hasMovies && !hasSeries ? (
                <EmptyState kicker={sc?.label ?? selectedShortcut} title="Sem títulos disponíveis." description="Nenhum resultado encontrado para essa categoria no momento." accent="neutral" />
              ) : null}
            </div>
          );
        })() : null}

        {/* Shortcut loading skeleton */}
        {!trimmedQuery && selectedShortcut && shortcutLoading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] animate-pulse rounded-[1.35rem] border border-white/[0.06] bg-white/[0.04]" />
            ))}
          </div>
        ) : null}

        {/* Default discovery (no query, no shortcut) */}
        {!trimmedQuery && !selectedShortcut && !hasSearched ? (
          <div className="flex flex-col gap-10">
            {!discoveryLoading && discovery ? (
              <div className="flex flex-col gap-10">
                {type === "movie" ? (() => {
                  const trendingMovies = discovery.trending?.filter((t) => t.media_type === "movie") ?? [];
                  const seen = new Set(trendingMovies.map((t) => t.tmdb_id));
                  const extra = (discovery.popularMovies ?? []).filter((t) => !seen.has(t.tmdb_id));
                  const merged = [...trendingMovies, ...extra];
                  return merged.length ? (
                    <section className="space-y-5">
                      <SectionHeader eyebrow="Em destaque" title="Filmes em alta e populares" subtitle="Filmes ganhando atenção e os mais assistidos agora." accent="indigo" />
                      <TitleGrid titles={merged} />
                    </section>
                  ) : null;
                })() : null}

                {type === "tv" ? (
                  <div className="flex flex-col gap-10">
                    {discovery.trending?.filter((t) => t.media_type === "tv").length ? (
                      <section className="space-y-5">
                        <SectionHeader eyebrow="Tendencias" title="Series em alta" subtitle="Series ganhando atencao agora." accent="indigo" />
                        <TitleGrid titles={discovery.trending.filter((t) => t.media_type === "tv")} />
                      </section>
                    ) : null}
                    {discovery.trending?.filter((t) => t.media_type === "tv").length && discovery.popularSeries?.length ? <SectionDivider /> : null}
                    {discovery.popularSeries?.length ? (
                      <section className="space-y-5">
                        <SectionHeader eyebrow="Populares" title="Series populares" subtitle="As series mais assistidas agora." accent="indigo" />
                        <TitleGrid titles={discovery.popularSeries} />
                      </section>
                    ) : null}
                  </div>
                ) : null}

                {type === "all" ? (
                  <div className="flex flex-col gap-10">
                    {discovery.trending?.length ? (
                      <section className="space-y-5">
                        <SectionHeader eyebrow="Tendencias" title="Em alta hoje" subtitle="Filmes e series ganhando atencao agora." accent="indigo" />
                        <TitleGrid titles={discovery.trending} />
                      </section>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

      </div>
    </PageShell>
  );
}

"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronLeft, ChevronRight, Film, Search, Sparkles, Tv, UserRound, X } from "lucide-react";
import PageShell from "@/components/layout/PageShell";
import InteractivePosterCard from "@/components/ui/InteractivePosterCard";
import EmptyState from "@/components/ui/EmptyState";
import SectionHeader from "@/components/ui/SectionHeader";
import ExploreShortcuts from "./ExploreShortcuts";
import { MediaGridSkeleton } from "@/components/skeletons/MediaGridSkeleton";
import { findShortcut } from "@/lib/discovery/shortcuts-config";
import { publicTitlePathFromSlug } from "@/server/titles/title-public-routes";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";
// ── Types ─────────────────────────────────────────────────────────────────────
type SearchMediaType = "all" | "movie" | "tv";
type SearchTitle = {
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
    best_provider_name?: string | null;
    best_provider_type?: string | null;
    best_provider_logo?: string | null;
};
type SearchPerson = {
    id: string;
    imdb_id?: string | null;
    name: string;
    profile_path: string | null;
    known_for_department: string | null;
    known_for: Array<{
        title: string;
        media_type?: string;
        year?: number | null;
        poster_path?: string | null;
    }>;
    href: string;
};
type SearchCompany = {
    id?: string | null;
    name: string;
    logo_path?: string | null;
    origin_country?: string | null;
    description?: string | null;
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
    companiesCount?: number;
    // new structured fields
    titles?: SearchTitle[];
    people?: SearchPerson[];
    companies?: SearchCompany[];
    // legacy compat
    results: SearchTitle[];
};
type ShortcutResultResponse = {
    ok: boolean;
    slug: string;
    title: string;
    displayTitle?: string;
    description: string;
    popularMovies?: SearchTitle[];
    popularSeries?: SearchTitle[];
    results: SearchTitle[];
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
type DiscoveryResponse = {
    ok: boolean;
    trending: SearchTitle[];
    popularMovies: SearchTitle[];
    popularSeries: SearchTitle[];
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
// ── Constants ─────────────────────────────────────────────────────────────────
const SEARCH_DEBOUNCE_MS = 300;
// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeMediaType(value: string): SearchMediaType {
    return value === "movie" || value === "tv" ? value : "all";
}
function normalizePage(value: number) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}
function getYear(title: SearchTitle) {
    const date = title.release_date ?? title.first_air_date;
    if (!date)
        return undefined;
    const year = new Date(date).getFullYear();
    return Number.isFinite(year) ? year : undefined;
}
function imageUrl(path: string | null | undefined, size = "w185") {
    return resolveCatalogImage(path, size);
}
function titleLinkId(title: SearchTitle) {
    return title.linkIdUsed ?? title.poplogId ?? title.externalIds?.imdbId ?? title.externalIds?.balloonerismmId ?? title.tmdb_id;
}
// ── Sub-components ────────────────────────────────────────────────────────────
function SectionDivider() {
    return <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"/>;
}
function TitleGrid({ titles }: {
    titles: SearchTitle[];
}) {
    return (<div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4 lg:grid-cols-6">
      {titles.map((title, index) => (<InteractivePosterCard key={`${title.media_type}-${title.tmdb_id}-${index}`} id={title.tmdb_id} poplogId={title.poplogId ?? null} imdbId={title.externalIds?.imdbId ?? null} slug={title.externalIds?.slug ?? null} href={publicTitlePathFromSlug(title.externalIds?.slug) ?? `/title/${title.media_type}/${titleLinkId(title)}`} mediaType={title.media_type} title={title.title} originalTitle={title.original_title ?? null} posterPath={title.poster_path} fallbackPath={title.backdrop_path} year={getYear(title)} source="search" priority={index < 2} bestProviderName={title.best_provider_name ?? null} bestProviderType={title.best_provider_type ?? null} bestProviderLogo={title.best_provider_logo ?? null}/>))}
    </div>);
}
function PeopleSection({ people }: {
    people: SearchPerson[];
}) {
    if (!people.length)
        return null;
    return (<section className="space-y-5">
      <SectionHeader eyebrow="Pessoas" title={uiMessage("ui.b8401c8280f4")} subtitle={uiMessage("ui.ace6e4682f54")} accent="indigo"/>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {people.map((person) => {
            const profileUrl = imageUrl(person.profile_path);
            const knownFor = person.known_for
                .map((t) => t.title)
                .filter(Boolean)
                .slice(0, 3)
                .join(", ");
            return (<Link key={person.id} href={person.href} className="group flex gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3 transition hover:-translate-y-0.5 hover:bg-white/[0.045] hover:border-white/[0.12]">
              <div className="relative flex size-[68px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.06]">
                {profileUrl ? (<Image src={profileUrl} alt={person.name} fill sizes="68px" className="object-cover transition duration-500 group-hover:scale-105"/>) : (<UserRound className="size-6 text-white/35"/>)}
              </div>
              <div className="min-w-0 py-1">
                <p className="truncate text-[13px] font-bold tracking-[-0.01em] text-white/90">{person.name}</p>
                <p className="mt-0.5 text-[11px] text-white/40">{person.known_for_department ?? "Cinema e TV"}</p>
                {knownFor ? (<p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-white/35">{uiMessage("ui.08a1ed02dc57")}{knownFor}
                  </p>) : null}
              </div>
            </Link>);
        })}
      </div>
    </section>);
}
function CompaniesSection({ companies }: {
    companies: SearchCompany[];
}) {
    if (!companies.length)
        return null;
    return (<section className="space-y-5">
      <SectionHeader eyebrow={uiMessage("ui.fa52b70aaa2a")} title={uiMessage("ui.5d18d3ed3bc8")} subtitle={uiMessage("ui.a921b4aa277c")} accent="indigo"/>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {companies.map((company) => (<div key={company.id ?? company.name} className="flex gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
            <div className="relative flex size-[52px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.06]">
              {company.logo_path ? (<Image src={resolveCatalogImage(company.logo_path, "w92") ?? ""} alt={company.name} fill sizes="52px" className="object-contain p-1"/>) : (<Building2 className="size-5 text-white/35"/>)}
            </div>
            <div className="min-w-0 py-1">
              <p className="truncate text-[13px] font-bold text-white/90">{company.name}</p>
              {company.origin_country ? (<p className="mt-0.5 text-[11px] text-white/40">{company.origin_country}</p>) : null}
              {company.description ? (<p className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/35">{company.description}</p>) : null}
            </div>
          </div>))}
      </div>
    </section>);
}
// ── Main component ────────────────────────────────────────────────────────────
export default function SearchPageView({ initialQuery, initialType, initialPage, initialShortcut = "", }: SearchPageViewProps) {
    const router = useRouter();
    const pathname = usePathname();
    const [query, setQuery] = useState(initialQuery);
    const [type, setType] = useState<SearchMediaType>(normalizeMediaType(initialType));
    const [page, setPage] = useState(() => normalizePage(initialPage));
    const [selectedShortcut, setSelectedShortcut] = useState(initialShortcut);
    const [loading, setLoading] = useState(false);
    const [titles, setTitles] = useState<SearchTitle[]>([]);
    const [people, setPeople] = useState<SearchPerson[]>([]);
    const [companies, setCompanies] = useState<SearchCompany[]>([]);
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
        const titlesCount = titles.length;
        const peopleCount = people.length;
        const parts: string[] = [];
        if (titlesCount > 0)
            parts.push(uiMessage("ui.b3d6f025873a", { v1: titlesCount, v2: titlesCount !== 1 ? "s" : "" }));
        if (peopleCount > 0)
            parts.push(`${peopleCount} pessoa${peopleCount !== 1 ? "s" : ""}`);
        if (parts.length === 0)
            return "Nenhum resultado";
        return parts.join(" · ");
    }, [titles.length, people.length]);
    const activeFiltersCount = useMemo(() => {
        let count = 0;
        if (type !== "all")
            count += 1;
        if (selectedShortcut)
            count += 1;
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
        setSelectedShortcut((current) => (current === slug ? "" : slug));
        setPage(1);
    }
    function clearFilters() {
        setType("all");
        setSelectedShortcut("");
        setPage(1);
    }
    // Sync URL
    useEffect(() => {
        const timeout = setTimeout(() => {
            const params = new URLSearchParams();
            if (trimmedQuery)
                params.set("q", trimmedQuery);
            if (type !== "all")
                params.set("type", type);
            if (trimmedQuery && page > 1)
                params.set("page", String(page));
            if (!trimmedQuery && selectedShortcut)
                params.set("atalho", selectedShortcut);
            const qs = params.toString();
            const nextUrl = qs ? `${pathname}?${qs}` : pathname;
            const currentUrl = `${window.location.pathname}${window.location.search}`;
            if (currentUrl !== nextUrl)
                router.replace(nextUrl, { scroll: false });
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timeout);
    }, [page, pathname, router, selectedShortcut, trimmedQuery, type]);
    // Load discovery
    useEffect(() => {
        if (trimmedQuery || selectedShortcut || discovery)
            return;
        const controller = new AbortController();
        async function load() {
            try {
                setDiscoveryLoading(true);
                const res = await fetch("/api/poplog3/search/discovery", { signal: controller.signal });
                const data: DiscoveryResponse = await res.json();
                if (data.ok)
                    setDiscovery(data);
            }
            catch (e) {
                if ((e as Error).name !== "AbortError")
                    console.error("[discovery]", e);
            }
            finally {
                setDiscoveryLoading(false);
            }
        }
        load();
        return () => controller.abort();
    }, [trimmedQuery, selectedShortcut, discovery]);
    // Load shortcut results
    useEffect(() => {
        if (trimmedQuery || !selectedShortcut) {
            setShortcutData(null);
            return;
        }
        const controller = new AbortController();
        async function load() {
            try {
                setShortcutLoading(true);
                const params = new URLSearchParams({ type });
                const res = await fetch(`/api/poplog3/discovery/shortcut/${encodeURIComponent(selectedShortcut)}?${params}`, { signal: controller.signal });
                const data: ShortcutResultResponse = await res.json();
                if (data.ok)
                    setShortcutData(data);
            }
            catch (e) {
                if ((e as Error).name !== "AbortError")
                    console.error("[shortcut-discover]", e);
            }
            finally {
                setShortcutLoading(false);
            }
        }
        load();
        return () => controller.abort();
    }, [trimmedQuery, selectedShortcut, type]);
    // Main search
    useEffect(() => {
        if (!trimmedQuery) {
            setTitles([]);
            setPeople([]);
            setCompanies([]);
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
                    setTitles([]);
                    setPeople([]);
                    setCompanies([]);
                    setSearchMeta(null);
                    setSearchError(uiMessage("ui.54478aced8ad"));
                    setHasSearched(true);
                    return;
                }
                // Prefer `titles` (new), fall back to `results` (legacy)
                setTitles(data.titles ?? data.results ?? []);
                setPeople(data.people ?? []);
                setCompanies(data.companies ?? []);
                setSearchMeta({
                    page: data.page ?? page,
                    totalPages: Math.max(1, data.totalPages ?? 1),
                    totalResults: data.totalResults ?? data.count ?? 0,
                    count: data.count ?? data.results?.length ?? 0,
                });
                setHasSearched(true);
            }
            catch (e) {
                if ((e as Error).name !== "AbortError") {
                    console.error("[search]", e);
                    setTitles([]);
                    setPeople([]);
                    setCompanies([]);
                    setSearchMeta(null);
                    setSearchError(uiMessage("ui.54478aced8ad"));
                    setHasSearched(true);
                }
            }
            finally {
                if (!controller.signal.aborted)
                    setLoading(false);
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            controller.abort();
            clearTimeout(timeout);
        };
    }, [page, trimmedQuery, type]);
    const hasAnyResult = titles.length > 0 || people.length > 0 || companies.length > 0;
    return (<PageShell variant="wide">
      <div className="flex flex-col gap-6 py-4 pb-2 sm:gap-8 sm:py-6 sm:pb-8">
        <div className="pointer-events-none fixed inset-x-0 top-0 z-30 h-44 bg-gradient-to-b from-[#060719] via-[#060719]/82 to-transparent sm:h-52"/>

        {/* ── Header ── */}
        <section className="sticky top-3 z-40 overflow-hidden rounded-[1.15rem] border border-white/[0.09] bg-[#080b1d]/88 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.34)] backdrop-blur-2xl sm:top-4 sm:rounded-[1.75rem] sm:p-6 md:p-8 lg:rounded-[2rem] lg:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(129,140,248,0.18),transparent_34%),radial-gradient(circle_at_88%_20%,rgba(6,182,212,0.10),transparent_30%)]"/>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent"/>
          <div className="relative grid gap-4 sm:gap-6 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
            <div className="hidden sm:order-1 sm:block">
              <div className="mb-3 hidden items-center gap-2 sm:flex md:mb-5">
                <span className="h-px w-5 rounded-full bg-indigo-300/80 sm:w-8"/>
                <span className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-indigo-200/80">{uiMessage("ui.a0a285dc8719")}</span>
              </div>
              <h1 className="text-xl font-black tracking-[-0.04em] text-white sm:text-4xl md:text-5xl lg:text-[3.25rem]">{uiMessage("ui.29c3bc91f32e")}</h1>
              <p className="mt-1.5 max-w-xl text-xs leading-5 text-white/45 sm:mt-3 sm:text-sm md:mt-4 md:text-base md:leading-7">{uiMessage("ui.797f0464d53e")}</p>
            </div>
            <div className="order-1 flex flex-col gap-2.5 sm:order-2 sm:gap-3">
              <div className="flex items-center gap-2 sm:hidden">
                <span className="h-px w-6 rounded-full bg-indigo-300/80"/>
                <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-indigo-200/80">{uiMessage("ui.a0a285dc8719")}</span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/35"/>
                <input value={query} onChange={(e) => handleQueryChange(e.target.value)} placeholder={uiMessage("ui.5cfe199b8592")} className="h-11 w-full rounded-2xl border border-white/[0.08] bg-black/30 pl-11 pr-4 text-sm font-medium text-white outline-none transition placeholder:text-white/30 focus:border-indigo-400/40 focus:bg-black/40 sm:h-12"/>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                {([
            { value: "all", label: "Todos", icon: Sparkles },
            { value: "movie", label: "Filmes", icon: Film },
            { value: "tv", label: uiMessage("ui.de212174bc0c"), icon: Tv },
        ] as const).map((item) => {
            const Icon = item.icon;
            const active = type === item.value;
            return (<button key={item.value} onClick={() => handleTypeChange(item.value)} className={`flex items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.10em] transition sm:justify-start sm:px-4 sm:text-[11px] sm:tracking-[0.12em] ${active
                    ? "border-indigo-300/35 bg-indigo-400/[0.13] text-indigo-100"
                    : "border-white/[0.08] bg-white/[0.035] text-white/55 hover:bg-white/[0.07] hover:text-white/80"}`}>
                      <Icon className="size-3.5"/>
                      {item.label}
                    </button>);
        })}
                {activeFiltersCount > 0 && (<button onClick={clearFilters} className="col-span-3 flex items-center justify-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.035] px-3.5 py-2 text-[10px] font-black uppercase tracking-[0.10em] text-white/45 transition hover:bg-white/[0.07] hover:text-white/70 sm:col-auto sm:text-[11px] sm:tracking-[0.12em]">
                    <X className="size-3"/>
                    Limpar
                  </button>)}
              </div>
            </div>
          </div>
        </section>

        {/* ── Explore shortcuts (no query) ── */}
        {!trimmedQuery ? (<ExploreShortcuts activeSlug={selectedShortcut} onSelect={handleShortcutSelect}/>) : null}

        {/* ── Skeleton ── */}
        {(loading || shortcutLoading || discoveryLoading) && !hasSearched ? (<MediaGridSkeleton items={12} ariaLabel={uiMessage("ui.e145da845aa8")}/>) : null}

        {loading && hasSearched ? (<div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-sm font-medium text-white/55">{uiMessage("ui.e145da845aa8")}</div>) : null}

        {searchError && hasSearched ? (<EmptyState kicker="Erro na busca" title={uiMessage("ui.a292bb04a8ae")} description={searchError} accent="neutral"/>) : null}

        {/* ── Results area (three independent blocks) ── */}
        {!searchError && !loading && hasSearched ? (<div className="flex flex-col gap-10">
            {/* 1. People */}
            <PeopleSection people={people}/>

            {/* 2. Titles */}
            {titles.length > 0 ? (<>
                {people.length > 0 ? <SectionDivider /> : null}
                <section className="space-y-5">
                  <SectionHeader eyebrow="Resultados" title={uiMessage("ui.e6aa88aa09d9")} subtitle={searchSubtitle} accent="indigo"/>
                  <TitleGrid titles={titles}/>
                  {searchMeta && searchMeta.totalPages > 1 ? (<div className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs font-semibold text-white/45">{uiMessage("ui.b3a7f96a26dc")}{searchMeta.page} de {searchMeta.totalPages}
                      </p>
                      <div className="grid grid-cols-2 gap-2 sm:flex">
                        <button type="button" onClick={() => setPage((v) => Math.max(1, v - 1))} disabled={page <= 1} className="flex items-center justify-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white/55 transition hover:bg-white/[0.07] hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-35">
                          <ChevronLeft className="size-3.5"/>
                          Anterior
                        </button>
                        <button type="button" onClick={() => setPage((v) => Math.min(maxSearchPage, v + 1))} disabled={page >= maxSearchPage} className="flex items-center justify-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white/55 transition hover:bg-white/[0.07] hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-35">{uiMessage("ui.e5f52d40e3a5")}<ChevronRight className="size-3.5"/>
                        </button>
                      </div>
                    </div>) : null}
                </section>
              </>) : null}

            {/* 3. Companies */}
            {companies.length > 0 ? (<>
                {(people.length > 0 || titles.length > 0) ? <SectionDivider /> : null}
                <CompaniesSection companies={companies}/>
              </>) : null}

            {/* Empty state */}
            {!hasAnyResult ? (<EmptyState kicker="Busca vazia" title={uiMessage("ui.2facd3dd693d")} description={uiMessage("ui.73b965ee4b0d")} accent="neutral"/>) : null}
          </div>) : null}

        {/* ── Shortcut results ── */}
        {!trimmedQuery && selectedShortcut && !shortcutLoading && shortcutData
            ? (() => {
                const sc = findShortcut(selectedShortcut);
                const eyebrow = sc?.group.label ?? "Descoberta";
                const displayTitle = shortcutData.displayTitle ?? shortcutData.title;
                const hasMovies = (shortcutData.popularMovies?.length ?? 0) > 0;
                const hasSeries = (shortcutData.popularSeries?.length ?? 0) > 0;
                const d = shortcutData.debug;
                return (<div className="flex flex-col gap-10">
                  {d
                        ? (() => {
                            console.log(`[search/shortcut] slug=${selectedShortcut} type=${type} source=${shortcutData.source} before=${d.beforeFilter} after=${d.afterFilter} fallback=${shortcutData.fallbackUsed} fallbackItems=${d.fallbackItems} slugs=${d.slugs?.join(",")}`);
                            return null;
                        })()
                        : null}
                  {shortcutData.fallbackUsed ? (<div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-2.5 text-[11px] font-medium text-amber-200/70">{uiMessage("ui.84322429ced2")}{shortcutData.title}{uiMessage("ui.0375f325b2ac")}</div>) : null}
                  {hasMovies ? (<section className="space-y-5">
                      <SectionHeader eyebrow={eyebrow} title={hasSeries ? `Filmes — ${displayTitle}` : displayTitle} subtitle={shortcutData.description} accent="indigo"/>
                      <TitleGrid titles={shortcutData.popularMovies!}/>
                    </section>) : null}
                  {hasMovies && hasSeries ? <SectionDivider /> : null}
                  {hasSeries ? (<section className="space-y-5">
                      <SectionHeader eyebrow={eyebrow} title={hasMovies ? uiMessage("ui.69831a3d732c", { v1: displayTitle }) : displayTitle} subtitle={hasMovies ? "" : shortcutData.description} accent="indigo"/>
                      <TitleGrid titles={shortcutData.popularSeries!}/>
                    </section>) : null}
                  {!hasMovies && !hasSeries ? (<EmptyState kicker={sc?.label ?? selectedShortcut} title={uiMessage("ui.6c6a2e4f29b0")} description={uiMessage("ui.4a1f3712cb7f")} accent="neutral"/>) : null}
                </div>);
            })()
            : null}

        {/* ── Shortcut skeleton ── */}
        {!trimmedQuery && selectedShortcut && shortcutLoading ? (<MediaGridSkeleton items={12}/>) : null}

        {/* ── Discovery (no query, no shortcut) ── */}
        {!trimmedQuery && !selectedShortcut && !hasSearched ? (<div className="flex flex-col gap-10">
            {!discoveryLoading && discovery ? (<div className="flex flex-col gap-10">
                {type === "movie"
                    ? (() => {
                        const trendingMovies = discovery.trending?.filter((t) => t.media_type === "movie") ?? [];
                        const seen = new Set(trendingMovies.map((t) => t.tmdb_id));
                        const extra = (discovery.popularMovies ?? []).filter((t) => !seen.has(t.tmdb_id));
                        const merged = [...trendingMovies, ...extra];
                        return merged.length ? (<section className="space-y-5">
                          <SectionHeader eyebrow={uiMessage("ui.68d1e85196ef")} title={uiMessage("ui.8d48f81748c7")} subtitle={uiMessage("ui.dd9460f8553e")} accent="indigo"/>
                          <TitleGrid titles={merged}/>
                        </section>) : null;
                    })()
                    : null}

                {type === "tv" ? (<div className="flex flex-col gap-10">
                    {discovery.trending?.filter((t) => t.media_type === "tv").length ? (<section className="space-y-5">
                        <SectionHeader eyebrow={uiMessage("ui.a43ecccd27a7")} title={uiMessage("ui.7dd6b1850fdb")} subtitle={uiMessage("ui.fce266ba876c")} accent="indigo"/>
                        <TitleGrid titles={discovery.trending.filter((t) => t.media_type === "tv")}/>
                      </section>) : null}
                    {discovery.trending?.filter((t) => t.media_type === "tv").length &&
                        discovery.popularSeries?.length ? (<SectionDivider />) : null}
                    {discovery.popularSeries?.length ? (<section className="space-y-5">
                        <SectionHeader eyebrow="Populares" title={uiMessage("ui.8d2f088cd382")} subtitle={uiMessage("ui.6fa5c47902fa")} accent="indigo"/>
                        <TitleGrid titles={discovery.popularSeries}/>
                      </section>) : null}
                  </div>) : null}

                {type === "all" ? (<div className="flex flex-col gap-10">
                    {discovery.trending?.length ? (<section className="space-y-5">
                        <SectionHeader eyebrow={uiMessage("ui.a43ecccd27a7")} title={uiMessage("ui.83760022f740")} subtitle={uiMessage("ui.bb8332b45a95")} accent="indigo"/>
                        <TitleGrid titles={discovery.trending}/>
                      </section>) : null}
                  </div>) : null}
              </div>) : null}
          </div>) : null}
      </div>
    </PageShell>);
}


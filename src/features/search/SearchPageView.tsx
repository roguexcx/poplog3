"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Film, Search, Sparkles, Tv, UserRound, X } from "lucide-react";

import PageShell from "@/components/layout/PageShell";
import InteractivePosterCard from "@/components/ui/InteractivePosterCard";
import EmptyState from "@/components/ui/EmptyState";
import SectionHeader from "@/components/ui/SectionHeader";

// ── Types ─────────────────────────────────────────────────────────────────────

type SearchMediaType = "all" | "movie" | "tv";

type SearchResult = {
  tmdb_id: number;
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

type DiscoveryGenre = {
  id: number;
  name: string;
};

type DiscoveryResponse = {
  ok: boolean;
  trending: SearchResult[];
  popularMovies: SearchResult[];
  popularSeries: SearchResult[];
  genres: DiscoveryGenre[];
};

type GenreDiscoverResponse = {
  ok: boolean;
  type: SearchMediaType;
  genre?: number;
  popular?: SearchResult[];
  topRated?: SearchResult[];
  popularMovies?: SearchResult[];
  popularSeries?: SearchResult[];
  results: SearchResult[];
};

type SearchPageViewProps = {
  initialQuery: string;
  initialType: string;
  initialPage: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getYear(title: SearchResult) {
  const date = title.release_date ?? title.first_air_date;
  if (!date) return undefined;
  const year = new Date(date).getFullYear();
  return Number.isFinite(year) ? year : undefined;
}

function imageUrl(path: string | null, size = "w185") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

// ── Primitives ────────────────────────────────────────────────────────────────

function SectionDivider() {
  return (
    <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
  );
}

// ── TitleGrid ─────────────────────────────────────────────────────────────────

function TitleGrid({ titles }: { titles: SearchResult[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4 lg:grid-cols-6">
      {titles.map((title) => (
        <InteractivePosterCard
          key={`${title.media_type}-${title.tmdb_id}`}
          id={title.tmdb_id}
          href={`/title/${title.media_type}/${title.tmdb_id}`}
          mediaType={title.media_type}
          title={title.title}
          posterPath={title.poster_path}
          fallbackPath={title.backdrop_path}
          year={getYear(title)}
          source="search"
        />
      ))}
    </div>
  );
}

// ── PeopleGrid ────────────────────────────────────────────────────────────────

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
                  <Image
                    src={profileUrl}
                    alt={person.name}
                    fill
                    sizes="68px"
                    className="object-cover transition duration-500 group-hover:scale-105"
                  />
                ) : (
                  <UserRound className="size-6 text-white/35" />
                )}
              </div>
              <div className="min-w-0 py-1">
                <p className="truncate text-[13px] font-bold tracking-[-0.01em] text-white/90">
                  {person.name}
                </p>
                <p className="mt-0.5 text-[11px] text-white/40">
                  {person.known_for_department ?? "Cinema e TV"}
                </p>
                {knownFor ? (
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-white/35">
                    Conhecido por {knownFor}
                  </p>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ── SearchPageView ────────────────────────────────────────────────────────────

export default function SearchPageView({ initialQuery, initialType }: SearchPageViewProps) {
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState<SearchMediaType>(
    initialType === "movie" || initialType === "tv" ? initialType : "all"
  );
  const [selectedGenre, setSelectedGenre] = useState<DiscoveryGenre | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [people, setPeople] = useState<SearchPerson[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
  const [genreLoading, setGenreLoading] = useState(false);
  const [genreDiscover, setGenreDiscover] = useState<GenreDiscoverResponse | null>(null);

  const trimmedQuery = useMemo(() => query.trim(), [query]);
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (type !== "all") count += 1;
    if (selectedGenre) count += 1;
    return count;
  }, [type, selectedGenre]);

  useEffect(() => {
    if (trimmedQuery || selectedGenre || discovery) return;
    const controller = new AbortController();
    async function loadDiscovery() {
      try {
        setDiscoveryLoading(true);
        const response = await fetch("/api/poplog3/search/discovery", { signal: controller.signal });
        const data: DiscoveryResponse = await response.json();
        if (data.ok) setDiscovery(data);
      } catch (error) {
        if ((error as Error).name !== "AbortError") console.error("[SearchPageView/discovery]", error);
      } finally {
        setDiscoveryLoading(false);
      }
    }
    loadDiscovery();
    return () => controller.abort();
  }, [trimmedQuery, selectedGenre, discovery]);

  useEffect(() => {
    if (trimmedQuery || !selectedGenre) { setGenreDiscover(null); return; }
    const controller = new AbortController();
    async function loadGenreDiscover() {
      try {
        setGenreLoading(true);
        const params = new URLSearchParams({ genre: String(selectedGenre!.id), type });
        const response = await fetch(`/api/poplog3/discover?${params}`, { signal: controller.signal });
        const data: GenreDiscoverResponse = await response.json();
        if (data.ok) setGenreDiscover(data);
      } catch (error) {
        if ((error as Error).name !== "AbortError") console.error("[SearchPageView/genre-discover]", error);
      } finally {
        setGenreLoading(false);
      }
    }
    loadGenreDiscover();
    return () => controller.abort();
  }, [trimmedQuery, selectedGenre, type]);

  useEffect(() => {
    if (!trimmedQuery) { setResults([]); setPeople([]); setHasSearched(false); return; }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({ q: trimmedQuery, type });
        if (selectedGenre) params.set("genre", String(selectedGenre.id));
        const response = await fetch(`/api/poplog3/search?${params}`, { signal: controller.signal });
        const data: SearchResponse = await response.json();
        if (!data.ok) { setResults([]); setPeople([]); return; }
        setResults(data.results);
        setPeople(data.people ?? []);
        setHasSearched(true);
      } catch (error) {
        if ((error as Error).name !== "AbortError") console.error("[SearchPageView]", error);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [trimmedQuery, type, selectedGenre]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <PageShell variant="wide">
      <div className="flex flex-col gap-8 py-6 pb-16">

        {/* ── Cabeçalho atmosférico com busca integrada ──────────────── */}
        <section className="relative overflow-hidden rounded-[1.25rem] border border-white/[0.07] bg-white/[0.025] p-5 sm:rounded-[1.75rem] sm:p-6 md:p-8 lg:rounded-[2rem] lg:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(129,140,248,0.18),transparent_34%),radial-gradient(circle_at_88%_20%,rgba(6,182,212,0.10),transparent_30%)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

          <div className="relative grid gap-6 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
            {/* Left: identity */}
            <div>
              <div className="mb-3 flex items-center gap-2 md:mb-5">
                <span className="h-px w-5 rounded-full bg-indigo-300/80 sm:w-8" />
                <span className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-indigo-200/80">
                  Buscar & Explorar
                </span>
              </div>
              <h1 className="text-2xl font-black tracking-[-0.04em] text-white sm:text-4xl md:text-5xl lg:text-[3.25rem]">
                Encontre qualquer coisa.
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/45 sm:mt-3 md:mt-4 md:text-base md:leading-7">
                Títulos, pessoas, gêneros e tendências da semana.
              </p>
            </div>

            {/* Right: search input + type filters */}
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/35" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Título, pessoa, saga ou universo..."
                  className="h-12 w-full rounded-2xl border border-white/[0.08] bg-black/30 pl-11 pr-4 text-sm font-medium text-white outline-none transition placeholder:text-white/30 focus:border-indigo-400/40 focus:bg-black/40"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { value: "all", label: "Todos", icon: Sparkles },
                    { value: "movie", label: "Filmes", icon: Film },
                    { value: "tv", label: "Séries", icon: Tv },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  const active = type === item.value;
                  return (
                    <button
                      key={item.value}
                      onClick={() => setType(item.value)}
                      className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] transition ${
                        active
                          ? "border-indigo-300/35 bg-indigo-400/[0.13] text-indigo-100"
                          : "border-white/[0.08] bg-white/[0.035] text-white/55 hover:bg-white/[0.07] hover:text-white/80"
                      }`}
                    >
                      <Icon className="size-3.5" />
                      {item.label}
                    </button>
                  );
                })}

                {activeFiltersCount > 0 && (
                  <button
                    onClick={() => { setType("all"); setSelectedGenre(null); }}
                    className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.035] px-3.5 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white/45 transition hover:bg-white/[0.07] hover:text-white/70"
                  >
                    <X className="size-3" />
                    Limpar
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Pills de gênero ────────────────────────────────────────── */}
        {discovery?.genres?.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {discovery.genres.slice(0, 14).map((genre) => {
              const active = selectedGenre?.id === genre.id;
              return (
                <button
                  key={genre.id}
                  onClick={() => setSelectedGenre(active ? null : genre)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-[11px] font-semibold transition ${
                    active
                      ? "border-indigo-400/40 bg-indigo-500/15 text-indigo-300"
                      : "border-white/[0.08] bg-white/[0.035] text-white/55 hover:bg-white/[0.07] hover:text-white/80"
                  }`}
                >
                  {genre.name}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* ── Skeleton ───────────────────────────────────────────────── */}
        {(loading || genreLoading || discoveryLoading) && !hasSearched ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[2/3] animate-pulse rounded-[1.35rem] border border-white/[0.06] bg-white/[0.04]"
              />
            ))}
          </div>
        ) : null}

        {/* ── Resultados de pessoas ───────────────────────────────────── */}
        {!loading && hasSearched && people.length > 0 ? <PeopleGrid people={people} /> : null}

        {/* ── Resultados de títulos ───────────────────────────────────── */}
        {!loading && hasSearched && results.length > 0 ? (
          <section className="space-y-5">
            <SectionHeader
              eyebrow="Resultados"
              title="Títulos encontrados"
              subtitle={
                selectedGenre
                  ? `${results.length} títulos em ${selectedGenre.name}`
                  : `${results.length} títulos encontrados`
              }
              accent="indigo"
            />
            <TitleGrid titles={results} />
          </section>
        ) : null}

        {/* ── Busca sem resultado ─────────────────────────────────────── */}
        {!loading && hasSearched && results.length === 0 && people.length === 0 ? (
          <EmptyState
            kicker="Busca vazia"
            title="Nenhum resultado encontrado."
            description="Tente outro termo, tipo ou gênero."
            accent="neutral"
          />
        ) : null}

        {/* ── Descoberta por gênero ───────────────────────────────────── */}
        {!trimmedQuery && selectedGenre && !genreLoading && genreDiscover ? (
          <div className="flex flex-col gap-10">
            {genreDiscover.popular?.length ? (
              <section className="space-y-5">
                <SectionHeader eyebrow={selectedGenre.name} title={`${selectedGenre.name} em destaque`} subtitle="Filmes e séries populares desse gênero." accent="indigo" />
                <TitleGrid titles={genreDiscover.popular} />
              </section>
            ) : null}

            {genreDiscover.topRated?.length ? (
              <>
                {genreDiscover.popular?.length ? <SectionDivider /> : null}
                <section className="space-y-5">
                  <SectionHeader eyebrow="Mais bem avaliados" title={`Melhores de ${selectedGenre.name}`} subtitle="Títulos com melhor recepção dentro do gênero." accent="indigo" />
                  <TitleGrid titles={genreDiscover.topRated} />
                </section>
              </>
            ) : null}

            {genreDiscover.popularMovies?.length ? (
              <>
                {(genreDiscover.popular?.length || genreDiscover.topRated?.length) ? <SectionDivider /> : null}
                <section className="space-y-5">
                  <SectionHeader eyebrow="Filmes" title={`Filmes de ${selectedGenre.name}`} subtitle="Filmes populares para explorar." accent="indigo" />
                  <TitleGrid titles={genreDiscover.popularMovies} />
                </section>
              </>
            ) : null}

            {genreDiscover.popularSeries?.length ? (
              <>
                {(genreDiscover.popular?.length || genreDiscover.topRated?.length || genreDiscover.popularMovies?.length) ? <SectionDivider /> : null}
                <section className="space-y-5">
                  <SectionHeader eyebrow="Séries" title={`Séries de ${selectedGenre.name}`} subtitle="Séries populares para acompanhar." accent="indigo" />
                  <TitleGrid titles={genreDiscover.popularSeries} />
                </section>
              </>
            ) : null}
          </div>
        ) : null}

        {/* ── Discovery padrão (sem query, sem gênero) ───────────────── */}
        {!trimmedQuery && !selectedGenre && !hasSearched ? (
          <div className="flex flex-col gap-10">
            {!discoveryLoading && discovery ? (
              <>
                {discovery.trending?.length ? (
                  <section className="space-y-5">
                    <SectionHeader eyebrow="Tendências" title="Em alta hoje" subtitle="Filmes e séries ganhando atenção agora." accent="indigo" />
                    <TitleGrid titles={discovery.trending} />
                  </section>
                ) : null}

                {discovery.trending?.length && discovery.popularMovies?.length ? <SectionDivider /> : null}

                {discovery.popularMovies?.length ? (
                  <section className="space-y-5">
                    <SectionHeader eyebrow="Filmes" title="Filmes populares" subtitle="Títulos fortes para explorar." accent="indigo" />
                    <TitleGrid titles={discovery.popularMovies} />
                  </section>
                ) : null}

                {(discovery.trending?.length || discovery.popularMovies?.length) && discovery.popularSeries?.length ? <SectionDivider /> : null}

                {discovery.popularSeries?.length ? (
                  <section className="space-y-5">
                    <SectionHeader eyebrow="Séries" title="Séries populares" subtitle="Séries em destaque." accent="indigo" />
                    <TitleGrid titles={discovery.popularSeries} />
                  </section>
                ) : null}
              </>
            ) : null}

            {!discoveryLoading && !discovery ? (
              <EmptyState
                kicker="Comece por aqui"
                title="Comece sua busca."
                description="Pesquise filmes, séries, pessoas ou explore por gênero."
                accent="indigo"
              />
            ) : null}
          </div>
        ) : null}

      </div>
    </PageShell>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Film, Search, Sparkles, Tv, UserRound, X } from "lucide-react";

import PageShell from "@/components/layout/PageShell";
import InteractivePosterCard from "@/components/ui/InteractivePosterCard";
import EmptyState from "@/components/ui/EmptyState";
import SectionHeader from "@/components/ui/SectionHeader";

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

type SpecialFilter = {
  id: string;
  label: string;
};

type SpecialDiscoverResponse = {
  ok: boolean;
  special: string;
  label: string;
  popular?: SearchResult[];
  popularMovies?: SearchResult[];
  popularSeries?: SearchResult[];
  topRated?: SearchResult[];
  results: SearchResult[];
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

function getYear(title: SearchResult) {
  const date = title.release_date ?? title.first_air_date;
  if (!date) return undefined;
  const year = new Date(date).getFullYear();
  return Number.isFinite(year) ? year : undefined;
}

function imageUrl(path: string | null, size = "w185") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function SectionDivider() {
  return (
    <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
  );
}

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
          originalTitle={title.original_title ?? null}
          posterPath={title.poster_path}
          fallbackPath={title.backdrop_path}
          year={getYear(title)}
          source="search"
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

const SPECIAL_FILTERS: SpecialFilter[] = [
  { id: "anime", label: "Animes" },
  { id: "plot-twist", label: "Plot Twist" },
];

export default function SearchPageView({ initialQuery, initialType }: SearchPageViewProps) {
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState<SearchMediaType>(
    initialType === "movie" || initialType === "tv" ? initialType : "all"
  );
  const [selectedGenre, setSelectedGenre] = useState<DiscoveryGenre | null>(null);
  const [selectedSpecial, setSelectedSpecial] = useState<SpecialFilter | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [people, setPeople] = useState<SearchPerson[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
  const [genreLoading, setGenreLoading] = useState(false);
  const [genreDiscover, setGenreDiscover] = useState<GenreDiscoverResponse | null>(null);
  const [specialLoading, setSpecialLoading] = useState(false);
  const [specialDiscover, setSpecialDiscover] = useState<SpecialDiscoverResponse | null>(null);

  const trimmedQuery = useMemo(() => query.trim(), [query]);
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (type !== "all") count += 1;
    if (selectedGenre) count += 1;
    if (selectedSpecial) count += 1;
    return count;
  }, [type, selectedGenre, selectedSpecial]);

  useEffect(() => {
    if (trimmedQuery || selectedGenre || selectedSpecial || discovery) return;
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
  }, [trimmedQuery, selectedGenre, selectedSpecial, discovery]);

  useEffect(() => {
    if (trimmedQuery || !selectedGenre) { setGenreDiscover(null); return; }
    const controller = new AbortController();
    async function load() {
      try {
        setGenreLoading(true);
        const params = new URLSearchParams({ genre: String(selectedGenre!.id), type });
        const res = await fetch(`/api/poplog3/discover?${params}`, { signal: controller.signal });
        const data: GenreDiscoverResponse = await res.json();
        if (data.ok) setGenreDiscover(data);
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.error("[genre-discover]", e);
      } finally {
        setGenreLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [trimmedQuery, selectedGenre, type]);

  useEffect(() => {
    if (trimmedQuery || !selectedSpecial) { setSpecialDiscover(null); return; }
    const controller = new AbortController();
    async function load() {
      try {
        setSpecialLoading(true);
        const params = new URLSearchParams({ special: selectedSpecial!.id });
        const res = await fetch(`/api/poplog3/discover/special?${params}`, { signal: controller.signal });
        const data: SpecialDiscoverResponse = await res.json();
        if (data.ok) setSpecialDiscover(data);
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.error("[special-discover]", e);
      } finally {
        setSpecialLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [trimmedQuery, selectedSpecial]);

  useEffect(() => {
    if (!trimmedQuery) { setResults([]); setPeople([]); setHasSearched(false); return; }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({ q: trimmedQuery, type });
        if (selectedGenre) params.set("genre", String(selectedGenre.id));
        const res = await fetch(`/api/poplog3/search?${params}`, { signal: controller.signal });
        const data: SearchResponse = await res.json();
        if (!data.ok) { setResults([]); setPeople([]); return; }
        setResults(data.results);
        setPeople(data.people ?? []);
        setHasSearched(true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.error("[search]", e);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [trimmedQuery, type, selectedGenre]);

  return (
    <PageShell variant="wide">
      <div className="flex flex-col gap-8 py-6 pb-16">

        {/* Header */}
        <section className="relative overflow-hidden rounded-[1.25rem] border border-white/[0.07] bg-white/[0.025] p-5 sm:rounded-[1.75rem] sm:p-6 md:p-8 lg:rounded-[2rem] lg:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(129,140,248,0.18),transparent_34%),radial-gradient(circle_at_88%_20%,rgba(6,182,212,0.10),transparent_30%)]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          <div className="relative grid gap-6 xl:grid-cols-[1.1fr_0.9fr] xl:items-center">
            <div>
              <div className="mb-3 flex items-center gap-2 md:mb-5">
                <span className="h-px w-5 rounded-full bg-indigo-300/80 sm:w-8" />
                <span className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-indigo-200/80">Buscar &amp; Explorar</span>
              </div>
              <h1 className="text-2xl font-black tracking-[-0.04em] text-white sm:text-4xl md:text-5xl lg:text-[3.25rem]">Encontre qualquer coisa.</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/45 sm:mt-3 md:mt-4 md:text-base md:leading-7">
                {"Títulos, pessoas, gêneros e tendências da semana."}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/35" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={"Título, pessoa, saga ou universo..."}
                  className="h-12 w-full rounded-2xl border border-white/[0.08] bg-black/30 pl-11 pr-4 text-sm font-medium text-white outline-none transition placeholder:text-white/30 focus:border-indigo-400/40 focus:bg-black/40"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  { value: "all", label: "Todos", icon: Sparkles },
                  { value: "movie", label: "Filmes", icon: Film },
                  { value: "tv", label: "Séries", icon: Tv },
                ] as const).map((item) => {
                  const Icon = item.icon;
                  const active = type === item.value;
                  return (
                    <button key={item.value} onClick={() => setType(item.value)}
                      className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-[11px] font-black uppercase tracking-[0.12em] transition ${active ? "border-indigo-300/35 bg-indigo-400/[0.13] text-indigo-100" : "border-white/[0.08] bg-white/[0.035] text-white/55 hover:bg-white/[0.07] hover:text-white/80"}`}>
                      <Icon className="size-3.5" />{item.label}
                    </button>
                  );
                })}
                {activeFiltersCount > 0 && (
                  <button onClick={() => { setType("all"); setSelectedGenre(null); setSelectedSpecial(null); }}
                    className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.035] px-3.5 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white/45 transition hover:bg-white/[0.07] hover:text-white/70">
                    <X className="size-3" />Limpar
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Genre pills + special filter pills */}
        {discovery?.genres?.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {discovery.genres.slice(0, 14).map((genre) => {
              const active = selectedGenre?.id === genre.id;
              return (
                <button key={genre.id}
                  onClick={() => { setSelectedSpecial(null); setSelectedGenre(active ? null : genre); }}
                  className={`shrink-0 rounded-full border px-4 py-2 text-[11px] font-semibold transition ${active ? "border-indigo-400/40 bg-indigo-500/15 text-indigo-300" : "border-white/[0.08] bg-white/[0.035] text-white/55 hover:bg-white/[0.07] hover:text-white/80"}`}>
                  {genre.name}
                </button>
              );
            })}
            <div className="mx-1 my-auto h-4 w-px shrink-0 bg-white/[0.10]" />
            {SPECIAL_FILTERS.map((sf) => {
              const active = selectedSpecial?.id === sf.id;
              return (
                <button key={sf.id}
                  onClick={() => { setSelectedGenre(null); setSelectedSpecial(active ? null : sf); }}
                  className={`shrink-0 rounded-full border px-4 py-2 text-[11px] font-semibold transition ${active ? "border-violet-400/40 bg-violet-500/15 text-violet-300" : "border-white/[0.08] bg-white/[0.035] text-white/55 hover:bg-white/[0.07] hover:text-white/80"}`}>
                  {sf.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Skeleton */}
        {(loading || genreLoading || discoveryLoading || specialLoading) && !hasSearched ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] animate-pulse rounded-[1.35rem] border border-white/[0.06] bg-white/[0.04]" />
            ))}
          </div>
        ) : null}

        {/* People results */}
        {!loading && hasSearched && people.length > 0 ? <PeopleGrid people={people} /> : null}

        {/* Title results */}
        {!loading && hasSearched && results.length > 0 ? (
          <section className="space-y-5">
            <SectionHeader
              eyebrow="Resultados"
              title="Títulos encontrados"
              subtitle={selectedGenre ? `${results.length} títulos em ${selectedGenre.name}` : `${results.length} títulos encontrados`}
              accent="indigo"
            />
            <TitleGrid titles={results} />
          </section>
        ) : null}

        {/* Empty search */}
        {!loading && hasSearched && results.length === 0 && people.length === 0 ? (
          <EmptyState kicker="Busca vazia" title="Nenhum resultado encontrado." description="Tente outro termo, tipo ou gênero." accent="neutral" />
        ) : null}

        {/* Special filter results (Animes / Plot Twist) */}
        {!trimmedQuery && selectedSpecial && !specialLoading && specialDiscover ? (
          <div className="flex flex-col gap-10">
            {selectedSpecial.id === "anime" ? (
              <div className="flex flex-col gap-10">
                {specialDiscover.popularSeries?.length ? (
                  <section className="space-y-5">
                    <SectionHeader eyebrow="Animes" title="Series de anime em alta" subtitle="Series de animacao japonesa mais assistidas agora." accent="indigo" />
                    <TitleGrid titles={specialDiscover.popularSeries} />
                  </section>
                ) : null}
                {specialDiscover.popularSeries?.length && specialDiscover.popularMovies?.length ? <SectionDivider /> : null}
                {specialDiscover.popularMovies?.length ? (
                  <section className="space-y-5">
                    <SectionHeader eyebrow="Animes" title="Filmes de anime em destaque" subtitle="Filmes de animacao japonesa populares no momento." accent="indigo" />
                    <TitleGrid titles={specialDiscover.popularMovies} />
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-10">
                {specialDiscover.popular?.length ? (
                  <section className="space-y-5">
                    <SectionHeader eyebrow="Plot Twist" title="Reviravoltas que ficam na memoria" subtitle="Titulos consagrados por finais e viradas inesqueciveis." accent="indigo" />
                    <TitleGrid titles={specialDiscover.popular} />
                  </section>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {/* Genre discover results */}
        {!trimmedQuery && selectedGenre && !genreLoading && genreDiscover ? (
          <div className="flex flex-col gap-10">
            {genreDiscover.popular?.length ? (
              <section className="space-y-5">
                <SectionHeader eyebrow={selectedGenre.name} title={`${selectedGenre.name} em destaque`} subtitle="Filmes e series populares desse genero." accent="indigo" />
                <TitleGrid titles={genreDiscover.popular} />
              </section>
            ) : null}
            {genreDiscover.topRated?.length ? (
              <div className="flex flex-col gap-10">
                {genreDiscover.popular?.length ? <SectionDivider /> : null}
                <section className="space-y-5">
                  <SectionHeader eyebrow="Mais bem avaliados" title={`Melhores de ${selectedGenre.name}`} subtitle="Titulos com melhor recepcao dentro do genero." accent="indigo" />
                  <TitleGrid titles={genreDiscover.topRated} />
                </section>
              </div>
            ) : null}
            {genreDiscover.popularMovies?.length ? (
              <div className="flex flex-col gap-10">
                {(genreDiscover.popular?.length || genreDiscover.topRated?.length) ? <SectionDivider /> : null}
                <section className="space-y-5">
                  <SectionHeader eyebrow="Filmes" title={`Filmes de ${selectedGenre.name}`} subtitle="Filmes populares para explorar." accent="indigo" />
                  <TitleGrid titles={genreDiscover.popularMovies} />
                </section>
              </div>
            ) : null}
            {genreDiscover.popularSeries?.length ? (
              <div className="flex flex-col gap-10">
                {(genreDiscover.popular?.length || genreDiscover.topRated?.length || genreDiscover.popularMovies?.length) ? <SectionDivider /> : null}
                <section className="space-y-5">
                  <SectionHeader eyebrow="Series" title={`Series de ${selectedGenre.name}`} subtitle="Series populares para acompanhar." accent="indigo" />
                  <TitleGrid titles={genreDiscover.popularSeries} />
                </section>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Default discovery (no query, no genre, no special) */}
        {!trimmedQuery && !selectedGenre && !selectedSpecial && !hasSearched ? (
          <div className="flex flex-col gap-10">
            {!discoveryLoading && discovery ? (
              <div className="flex flex-col gap-10">
                {type === "movie" ? (
                  <div className="flex flex-col gap-10">
                    {discovery.trending?.filter((t) => t.media_type === "movie").length ? (
                      <section className="space-y-5">
                        <SectionHeader eyebrow="Tendencias" title="Filmes em alta" subtitle="Filmes ganhando atencao agora." accent="indigo" />
                        <TitleGrid titles={discovery.trending.filter((t) => t.media_type === "movie")} />
                      </section>
                    ) : null}
                    {discovery.trending?.filter((t) => t.media_type === "movie").length && discovery.popularMovies?.length ? <SectionDivider /> : null}
                    {discovery.popularMovies?.length ? (
                      <section className="space-y-5">
                        <SectionHeader eyebrow="Populares" title="Filmes populares" subtitle="Os filmes mais assistidos agora." accent="indigo" />
                        <TitleGrid titles={discovery.popularMovies} />
                      </section>
                    ) : null}
                  </div>
                ) : null}

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

            {!discoveryLoading && !discovery ? (
              <EmptyState kicker="Comece por aqui" title="Comece sua busca." description="Pesquise filmes, series, pessoas ou explore por genero." accent="indigo" />
            ) : null}
          </div>
        ) : null}

      </div>
    </PageShell>
  );
}

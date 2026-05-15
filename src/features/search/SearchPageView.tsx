"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Compass, Film, Search, Sparkles, TrendingUp, Tv, UserRound, X } from "lucide-react";

import PosterCard from "@/components/ui/PosterCard";
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

function TitleGrid({ titles }: { titles: SearchResult[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4 lg:grid-cols-6">
      {titles.map((title) => (
        <PosterCard
          key={`${title.media_type}-${title.tmdb_id}`}
          href={`/title/${title.media_type}/${title.tmdb_id}`}
          mediaType={title.media_type}
          title={title.title}
          posterPath={title.poster_path}
          fallbackPath={title.backdrop_path}
          year={getYear(title)}
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
        title="Pessoas encontradas"
        description="Atores, diretores e criadores relacionados à busca."
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {people.map((person) => {
          const profileUrl = imageUrl(person.profile_path);
          const knownFor = person.known_for
            .map((title) => title.title)
            .filter(Boolean)
            .slice(0, 3)
            .join(", ");

          return (
            <Link
              key={person.tmdb_id}
              href={person.href}
              className="group flex gap-4 rounded-[28px] border border-white/[0.08] bg-white/[0.035] p-3 backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/[0.07]"
            >
              <div className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/[0.06]">
                {profileUrl ? (
                  <Image
                    src={profileUrl}
                    alt={person.name}
                    fill
                    sizes="80px"
                    className="object-cover transition duration-500 group-hover:scale-105"
                  />
                ) : (
                  <UserRound className="size-7 text-white/35" />
                )}
              </div>

              <div className="min-w-0 py-1">
                <p className="truncate text-sm font-bold text-white">{person.name}</p>

                <p className="mt-1 text-xs font-medium text-white/45">
                  {person.known_for_department ?? "Cinema e TV"}
                </p>

                {knownFor ? (
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/45">
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

        const response = await fetch("/api/poplog3/search/discovery", {
          signal: controller.signal,
        });

        const data: DiscoveryResponse = await response.json();

        if (data.ok) setDiscovery(data);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("[SearchPageView/discovery]", error);
        }
      } finally {
        setDiscoveryLoading(false);
      }
    }

    loadDiscovery();

    return () => controller.abort();
  }, [trimmedQuery, selectedGenre, discovery]);

  useEffect(() => {
    if (trimmedQuery || !selectedGenre) {
      setGenreDiscover(null);
      return;
    }

    const controller = new AbortController();

    async function loadGenreDiscover() {
      try {
        setGenreLoading(true);

        const params = new URLSearchParams({
          genre: String(selectedGenre.id),
          type,
        });

        const response = await fetch(`/api/poplog3/discover?${params}`, {
          signal: controller.signal,
        });

        const data: GenreDiscoverResponse = await response.json();

        if (data.ok) setGenreDiscover(data);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("[SearchPageView/genre-discover]", error);
        }
      } finally {
        setGenreLoading(false);
      }
    }

    loadGenreDiscover();

    return () => controller.abort();
  }, [trimmedQuery, selectedGenre, type]);

  useEffect(() => {
    if (!trimmedQuery) {
      setResults([]);
      setPeople([]);
      setHasSearched(false);
      return;
    }

    const controller = new AbortController();

    const timeout = setTimeout(async () => {
      try {
        setLoading(true);

        const params = new URLSearchParams({
          q: trimmedQuery,
          type,
        });

        if (selectedGenre) {
          params.set("genre", String(selectedGenre.id));
        }

        const response = await fetch(`/api/poplog3/search?${params}`, {
          signal: controller.signal,
        });

        const data: SearchResponse = await response.json();

        if (!data.ok) {
          setResults([]);
          setPeople([]);
          return;
        }

        setResults(data.results);
        setPeople(data.people ?? []);
        setHasSearched(true);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("[SearchPageView]", error);
        }
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [trimmedQuery, type, selectedGenre]);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#030712]" />
      <div className="pointer-events-none fixed left-1/2 top-0 -z-10 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-[140px]" />
      <div className="pointer-events-none fixed bottom-0 right-0 -z-10 h-[420px] w-[520px] rounded-full bg-cyan-500/10 blur-[120px]" />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 pb-16 md:px-6">
        <section className="relative overflow-hidden rounded-[34px] border border-white/[0.08] bg-white/[0.04] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl md:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(99,102,241,0.28),transparent_34%),radial-gradient(circle_at_85%_20%,rgba(6,182,212,0.16),transparent_30%)]" />

          <div className="relative grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <div className="mb-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.24em] text-indigo-200/80">
                <span className="h-px w-10 bg-indigo-300/70" />
                Buscar
              </div>

              <h1 className="max-w-3xl text-5xl font-black tracking-[-0.06em] text-white md:text-7xl">
                Seu portal de descoberta.
              </h1>

              <p className="mt-5 max-w-2xl text-base leading-7 text-white/58">
                Busque títulos, atores, diretores e criadores ou explore tendências por gênero.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-3xl border border-white/[0.08] bg-black/20 p-4">
                <Sparkles className="mb-4 size-5 text-cyan-200" />
                <p className="text-sm font-semibold text-white">Busca universal</p>
                <p className="mt-1 text-xs leading-5 text-white/45">Filmes, séries e pessoas.</p>
              </div>

              <div className="rounded-3xl border border-white/[0.08] bg-black/20 p-4">
                <TrendingUp className="mb-4 size-5 text-indigo-200" />
                <p className="text-sm font-semibold text-white">Descoberta</p>
                <p className="mt-1 text-xs leading-5 text-white/45">Tendências por gênero.</p>
              </div>

              <div className="rounded-3xl border border-white/[0.08] bg-black/20 p-4">
                <Compass className="mb-4 size-5 text-amber-200" />
                <p className="text-sm font-semibold text-white">Exploração</p>
                <p className="mt-1 text-xs leading-5 text-white/45">Categorias vivas.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="sticky top-4 z-20 rounded-[30px] border border-white/[0.08] bg-[#070b18]/80 p-3 shadow-2xl shadow-black/30 backdrop-blur-2xl">
          <div className="flex flex-col gap-3 xl:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-5 top-1/2 size-5 -translate-y-1/2 text-white/35" />

              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por título, pessoa, saga ou universo..."
                className="h-16 w-full rounded-[22px] border border-white/[0.08] bg-black/35 pl-14 pr-5 text-sm font-medium text-white outline-none transition placeholder:text-white/30 focus:border-cyan-300/40 focus:bg-black/50"
              />
            </div>

            <div className="grid grid-cols-3 gap-2 lg:flex">
              {[
                { value: "all", label: "Todos", icon: Sparkles },
                { value: "movie", label: "Filmes", icon: Film },
                { value: "tv", label: "Séries", icon: Tv },
              ].map((item) => {
                const Icon = item.icon;
                const active = type === item.value;

                return (
                  <button
                    key={item.value}
                    onClick={() => setType(item.value as SearchMediaType)}
                    className={`flex h-16 items-center justify-center gap-2 rounded-[22px] px-5 text-sm font-semibold transition ${
                      active
                        ? "bg-white text-black shadow-lg shadow-white/10"
                        : "border border-white/[0.08] bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white"
                    }`}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>

            {activeFiltersCount > 0 ? (
              <button
                onClick={() => {
                  setType("all");
                  setSelectedGenre(null);
                }}
                className="flex h-16 items-center justify-center gap-2 rounded-[22px] border border-white/[0.08] bg-white/[0.04] px-5 text-sm font-semibold text-white/65 transition hover:bg-white/[0.08] hover:text-white"
              >
                <X className="size-4" />
                Limpar
              </button>
            ) : null}
          </div>

          {discovery?.genres?.length ? (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {discovery.genres.slice(0, 14).map((genre) => {
                const active = selectedGenre?.id === genre.id;

                return (
                  <button
                    key={genre.id}
                    onClick={() => setSelectedGenre(active ? null : genre)}
                    className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition ${
                      active
                        ? "bg-white text-black"
                        : "border border-white/[0.08] bg-white/[0.035] text-white/55 hover:bg-white/[0.08] hover:text-white"
                    }`}
                  >
                    {genre.name}
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>

        {(loading || genreLoading || discoveryLoading) && !hasSearched ? (
          <section className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, index) => (
              <div
                key={index}
                className="aspect-[2/3] animate-pulse rounded-[28px] border border-white/[0.06] bg-white/[0.055]"
              />
            ))}
          </section>
        ) : null}

        {!loading && hasSearched && people.length > 0 ? <PeopleGrid people={people} /> : null}

        {!loading && hasSearched && results.length > 0 ? (
          <section className="space-y-5">
            <SectionHeader
              title="Títulos encontrados"
              description={
                selectedGenre
                  ? `${results.length} títulos encontrados em ${selectedGenre.name}`
                  : `${results.length} títulos encontrados`
              }
            />

            <TitleGrid titles={results} />
          </section>
        ) : null}

        {!loading && hasSearched && results.length === 0 && people.length === 0 ? (
          <EmptyState
            title="Nenhum resultado encontrado."
            description="Tente outro termo, tipo ou gênero."
          />
        ) : null}

        {!trimmedQuery && selectedGenre && !genreLoading && genreDiscover ? (
          <section className="space-y-10">
            {genreDiscover.popular?.length ? (
              <section className="space-y-5">
                <SectionHeader
                  title={`${selectedGenre.name} em destaque`}
                  description="Filmes e séries populares desse gênero."
                />
                <TitleGrid titles={genreDiscover.popular} />
              </section>
            ) : null}

            {genreDiscover.topRated?.length ? (
              <section className="space-y-5">
                <SectionHeader
                  title={`Mais bem avaliados em ${selectedGenre.name}`}
                  description="Títulos com melhor recepção dentro do gênero."
                />
                <TitleGrid titles={genreDiscover.topRated} />
              </section>
            ) : null}

            {genreDiscover.popularMovies?.length ? (
              <section className="space-y-5">
                <SectionHeader
                  title={`Filmes de ${selectedGenre.name}`}
                  description="Filmes populares para explorar."
                />
                <TitleGrid titles={genreDiscover.popularMovies} />
              </section>
            ) : null}

            {genreDiscover.popularSeries?.length ? (
              <section className="space-y-5">
                <SectionHeader
                  title={`Séries de ${selectedGenre.name}`}
                  description="Séries populares para acompanhar."
                />
                <TitleGrid titles={genreDiscover.popularSeries} />
              </section>
            ) : null}
          </section>
        ) : null}

        {!trimmedQuery && !selectedGenre && !hasSearched ? (
          <section className="space-y-10">
            {!discoveryLoading && discovery ? (
              <>
                {discovery.trending?.length ? (
                  <section className="space-y-5">
                    <SectionHeader
                      title="Em alta hoje"
                      description="Filmes e séries ganhando atenção agora."
                    />
                    <TitleGrid titles={discovery.trending} />
                  </section>
                ) : null}

                {discovery.popularMovies?.length ? (
                  <section className="space-y-5">
                    <SectionHeader title="Filmes populares" description="Títulos fortes para explorar." />
                    <TitleGrid titles={discovery.popularMovies} />
                  </section>
                ) : null}

                {discovery.popularSeries?.length ? (
                  <section className="space-y-5">
                    <SectionHeader title="Séries populares" description="Séries em destaque." />
                    <TitleGrid titles={discovery.popularSeries} />
                  </section>
                ) : null}
              </>
            ) : null}

            {!discoveryLoading && !discovery ? (
              <EmptyState
                title="Comece sua busca."
                description="Pesquise filmes, séries, pessoas ou explore por gênero."
              />
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
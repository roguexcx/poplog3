// src/app/buscar/BuscarClient.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { Search } from "lucide-react";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import { getOriginalTitle, getPosterUrl, getRating, getReleaseYear, getTitle } from "@/lib/tmdb-utils";
import type { TMDBItem } from "@/types/tmdb";

// ─── Mapeamento de categorias → genre_ids TMDB ────────────────────────────────

type Category = {
  label: string;
  movieGenreId?: number;
  tvGenreId?: number;
  type: "trending" | "genre";
};

const CATEGORIES: Category[] = [
  { label: "Em Alta",    type: "trending" },
  { label: "Ação",       type: "genre", movieGenreId: 28,    tvGenreId: 10759 },
  { label: "Comédia",    type: "genre", movieGenreId: 35,    tvGenreId: 35    },
  { label: "Terror",     type: "genre", movieGenreId: 27,    tvGenreId: 9648  },
  { label: "Animação",   type: "genre", movieGenreId: 16,    tvGenreId: 16    },
  { label: "Drama",      type: "genre", movieGenreId: 18,    tvGenreId: 18    },
  { label: "Sci-Fi",     type: "genre", movieGenreId: 878,   tvGenreId: 10765 },
  { label: "Romance",    type: "genre", movieGenreId: 10749, tvGenreId: 10749 },
  { label: "Thriller",   type: "genre", movieGenreId: 53,    tvGenreId: 9648  },
  { label: "Aventura",   type: "genre", movieGenreId: 12,    tvGenreId: 10759 },
];

// ─── Debounce hook ────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─── ResultCard ───────────────────────────────────────────────────────────────

function ResultCard({ item, priority = false }: { item: TMDBItem; priority?: boolean }) {
  const type   = item.media_type ?? "movie";
  const title  = getTitle(item);
  const originalTitle = getOriginalTitle(item);
  const year   = getReleaseYear(item);
  const rating = getRating(item);
  const poster = getPosterUrl(item.poster_path, "w342");

  return (
    <Link href={`/title/${type}/${item.id}`} className="group block">
      <div className="relative overflow-hidden rounded-[14px] bg-zinc-900/60 ring-1 ring-white/[0.07] transition-[transform,ring-color] duration-300 group-hover:-translate-y-1 group-hover:ring-white/[0.18]">
        {poster ? (
          <Image
            src={poster}
            alt={title}
            width={342}
            height={513}
            priority={priority}
            loading={priority ? "eager" : "lazy"}
            className="aspect-[2/3] w-full object-cover brightness-[0.90] transition duration-500 group-hover:scale-[1.04] group-hover:brightness-100"
          />
        ) : (
          <div className="aspect-[2/3] w-full flex items-center justify-center bg-zinc-900 text-zinc-700 text-xs">
            Sem poster
          </div>
        )}
        {rating && (
          <span className="absolute bottom-2 left-2 rounded-full border border-white/[0.15] bg-black/[0.75] px-2 py-0.5 text-[10px] font-black text-amber-400 backdrop-blur-[6px]">
            ⭐ {rating}
          </span>
        )}
      </div>
      <div className="mt-2 px-0.5">
        <LocalizedTitle
          title={title}
          originalTitle={originalTitle}
          variant="poster"
          className="line-clamp-2 text-[12px] font-medium leading-[1.35] text-[#e0e0f0]"
        />
        <p className="mt-0.5 text-[10px] text-zinc-600">
          {year !== "----" ? `${year} · ` : ""}
          {type === "movie" ? "Filme" : "Série"}
        </p>
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[2/3] w-full rounded-[14px] bg-white/[0.06]" />
      <div className="mt-2 h-3 w-3/4 rounded bg-white/[0.06]" />
      <div className="mt-1 h-3 w-1/2 rounded bg-white/[0.04]" />
    </div>
  );
}

// ─── Component principal ─────────────────────────────────────────────────────

export default function BuscarClient() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery]                   = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>("Em Alta");
  const [results, setResults]               = useState<TMDBItem[]>([]);
  const [loading, setLoading]               = useState(false);

  const debouncedQuery = useDebounce(query, 350);

  // ── Fetch por texto ──────────────────────────────────────────────────────
  const fetchSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/search?query=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = await res.json();
      setResults(
        (data.results ?? []).filter(
          (item: TMDBItem) => item.media_type === "movie" || item.media_type === "tv",
        ),
      );
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch por categoria (genre_id real, não busca textual) ────────────────
  const fetchCategory = useCallback(async (cat: Category) => {
    setLoading(true);
    try {
      if (cat.type === "trending") {
        const res = await fetch("/api/tmdb/list?type=trending");
        if (!res.ok) return;
        const data = await res.json();
        setResults(data.results ?? []);
        return;
      }

      const [movieRes, tvRes] = await Promise.all([
        cat.movieGenreId
          ? fetch(`/api/tmdb/discover?genre=${cat.movieGenreId}&media=movie`)
          : Promise.resolve(null),
        cat.tvGenreId
          ? fetch(`/api/tmdb/discover?genre=${cat.tvGenreId}&media=tv`)
          : Promise.resolve(null),
      ]);

      const movieData = movieRes?.ok ? await movieRes.json() : { results: [] };
      const tvData    = tvRes?.ok   ? await tvRes.json()    : { results: [] };

      const movies: TMDBItem[] = (movieData.results ?? []).slice(0, 10);
      const tvs:    TMDBItem[] = (tvData.results ?? []).slice(0, 10);

      // Intercala filmes e séries
      const combined: TMDBItem[] = [];
      const max = Math.max(movies.length, tvs.length);
      for (let i = 0; i < max; i++) {
        if (movies[i]) combined.push(movies[i]);
        if (tvs[i])    combined.push(tvs[i]);
      }
      setResults(combined);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Texto digitado prevalece sobre categoria ──────────────────────────────
  useEffect(() => {
    if (debouncedQuery.trim()) {
      setActiveCategory(null);
      fetchSearch(debouncedQuery);
    } else if (activeCategory) {
      const cat = CATEGORIES.find((c) => c.label === activeCategory);
      if (cat) fetchCategory(cat);
    }
  }, [debouncedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mudança de categoria ──────────────────────────────────────────────────
  useEffect(() => {
    if (activeCategory) {
      setQuery("");
      const cat = CATEGORIES.find((c) => c.label === activeCategory);
      if (cat) fetchCategory(cat);
    }
  }, [activeCategory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carrega "Em Alta" na montagem
  useEffect(() => {
    fetchCategory(CATEGORIES[0]);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCategoryClick(cat: Category) {
    setActiveCategory(cat.label);
    setQuery("");
    inputRef.current?.blur();
  }

  return (
    <main className="min-h-screen bg-[#020617] pb-28 text-white md:pb-10">
      <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6 md:py-12">

        {/* Campo de busca */}
        <div className="relative mb-6">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500"
            size={22}
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim()) setActiveCategory(null);
            }}
            placeholder="Buscar filmes e séries..."
            autoComplete="off"
            className="h-[52px] w-full rounded-2xl border border-white/10 bg-white/[0.05] pl-12 pr-10 text-base text-white placeholder:text-zinc-600 outline-none transition focus:border-indigo-500/50 focus:bg-white/[0.07] md:h-[56px]"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setActiveCategory("Em Alta"); inputRef.current?.focus(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition"
            >
              ✕
            </button>
          )}
        </div>

        {/* Botões de categoria — filtro por genre_id real, não busca textual */}
        <div className="no-scrollbar mb-8 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.label}
              type="button"
              onClick={() => handleCategoryClick(cat)}
              className={[
                "shrink-0 rounded-full border px-4 py-2 text-sm font-bold transition",
                activeCategory === cat.label
                  ? "border-indigo-500 bg-indigo-500/20 text-indigo-300"
                  : "border-white/10 text-zinc-500 hover:border-white/20 hover:text-zinc-300",
              ].join(" ")}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Skeletons */}
        {loading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Resultados */}
        {!loading && results.length > 0 && (
          <>
            {activeCategory && !query && (
              <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-600">
                {activeCategory === "Em Alta" ? "Em alta agora" : activeCategory}
              </p>
            )}
            {query && (
              <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-600">
                {results.length} resultado{results.length !== 1 ? "s" : ""} para &ldquo;{query}&rdquo;
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {results.map((item, i) => (
                <ResultCard
                  key={`${item.media_type ?? "movie"}-${item.id}`}
                  item={item}
                  priority={i < 4}
                />
              ))}
            </div>
          </>
        )}

        {/* Sem resultados após busca por texto */}
        {!loading && results.length === 0 && query && (
          <div className="py-24 text-center">
            <p className="text-zinc-500">Nenhum resultado para &ldquo;{query}&rdquo;</p>
            <p className="mt-2 text-sm text-zinc-700">Tente outros termos ou verifique a ortografia</p>
            <button
              type="button"
              onClick={() => { setQuery(""); setActiveCategory("Em Alta"); }}
              className="mt-6 text-xs font-bold text-indigo-400 hover:text-indigo-300 transition"
            >
              Limpar busca
            </button>
          </div>
        )}

      </div>
    </main>
  );
}

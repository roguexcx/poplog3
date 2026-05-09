// src/app/buscar/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getPosterUrl, getRating, getReleaseYear, getTitle } from "@/lib/tmdb-utils";
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

function ResultCard({ item }: { item: TMDBItem }) {
  const type   = item.media_type ?? "movie";
  const title  = getTitle(item);
  const year   = getReleaseYear(item);
  const rating = getRating(item);
  const poster = getPosterUrl(item.poster_path, "w342");

  return (
    <Link
      href={`/title/${type}/${item.id}`}
      className="group block"
    >
      <div className="relative overflow-hidden rounded-[14px] bg-zinc-900/60 ring-1 ring-white/[0.07] transition-[transform,ring-color] duration-300 group-hover:-translate-y-1 group-hover:ring-white/[0.18]">
        {poster ? (
          <Image
            src={poster}
            alt={title}
            width={342}
            height={513}
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
        <p className="line-clamp-2 text-[12px] font-medium leading-[1.35] text-[#e0e0f0]">{title}</p>
        <p className="mt-0.5 text-[10px] text-zinc-600">
          {year !== "----" ? `${year} · ` : ""}
          {type === "movie" ? "Filme" : "Série"}
        </p>
      </div>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuscarPage() {
  const router = useRouter();
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
      setResults(data.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch por categoria ──────────────────────────────────────────────────
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

      // Busca para filmes e séries em paralelo e intercala
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

  // ── Efeito: texto digitado prevalece sobre categoria ─────────────────────
  useEffect(() => {
    if (debouncedQuery.trim()) {
      setActiveCategory(null);
      fetchSearch(debouncedQuery);
    } else if (activeCategory) {
      const cat = CATEGORIES.find((c) => c.label === activeCategory);
      if (cat) fetchCategory(cat);
    }
  }, [debouncedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Efeito: mudança de categoria ─────────────────────────────────────────
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCategoryClick(cat: Category) {
    setActiveCategory(cat.label);
    setQuery("");
    inputRef.current?.blur();
  }

  return (
    <main className="min-h-screen bg-[#020617] pb-28 text-white md:pb-10">
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">

        {/* Título da página */}
        <h1 className="mb-6 text-2xl font-black tracking-tight">Buscar</h1>

        {/* Campo de busca */}
        <div className="relative mb-6">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-sm">
            🔎
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim()) setActiveCategory(null);
            }}
            placeholder="Filmes, séries, universos..."
            className="h-[52px] w-full rounded-[14px] border border-white/[0.09] bg-white/[0.05] px-[46px] text-[14px] text-white/80 outline-none transition placeholder:text-white/25 focus:border-white/[0.18] focus:bg-white/[0.07]"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setActiveCategory("Em Alta"); inputRef.current?.focus(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition"
            >
              ✕
            </button>
          )}
        </div>

        {/* Botões de categoria */}
        <div className="mb-8 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.label}
              type="button"
              onClick={() => handleCategoryClick(cat)}
              className={[
                "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition",
                activeCategory === cat.label
                  ? "border-indigo-400/60 bg-indigo-500/20 text-indigo-200"
                  : "border-white/10 bg-white/[0.04] text-zinc-400 hover:border-white/20 hover:text-zinc-200",
              ].join(" ")}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Estado de carregamento */}
        {loading && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {Array.from({ length: 14 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[2/3] w-full rounded-[14px] bg-white/[0.05]" />
                <div className="mt-2 h-3 w-3/4 rounded bg-white/[0.04]" />
                <div className="mt-1.5 h-2.5 w-1/2 rounded bg-white/[0.03]" />
              </div>
            ))}
          </div>
        )}

        {/* Resultados */}
        {!loading && results.length > 0 && (
          <>
            {activeCategory && !query && (
              <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                {activeCategory === "Em Alta" ? "Em alta agora" : activeCategory}
              </p>
            )}
            {query && !loading && (
              <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                {results.length} resultado{results.length !== 1 ? "s" : ""} para &ldquo;{query}&rdquo;
              </p>
            )}
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
              {results.map((item) => (
                <ResultCard key={`${item.media_type ?? "movie"}-${item.id}`} item={item} />
              ))}
            </div>
          </>
        )}

        {/* Sem resultados */}
        {!loading && results.length === 0 && query && (
          <div className="py-20 text-center">
            <p className="text-zinc-500">Nenhum resultado para &ldquo;{query}&rdquo;.</p>
            <button
              type="button"
              onClick={() => { setQuery(""); setActiveCategory("Em Alta"); }}
              className="mt-4 text-xs font-bold text-indigo-400 hover:text-indigo-300 transition"
            >
              Limpar busca
            </button>
          </div>
        )}

      </div>
    </main>
  );
}

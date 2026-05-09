"use client";

import { useRef, useEffect, useState } from "react";
import { Search } from "lucide-react";
import PosterCard from "@/components/posters/PosterCard";
import { useSearch } from "@/features/search/useSearch";
import type { TMDBItem } from "@/types/tmdb";

type FilterType = "all" | "movie" | "tv";

const SUGGESTION_CHIPS = [
  "Em Alta",
  "Ação",
  "Comédia",
  "Terror",
  "Animação",
  "Drama",
  "Sci-Fi",
  "Romance",
  "Thriller",
  "Aventura",
];

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[2/3] rounded-[14px] bg-white/[0.06]" />
      <div className="mt-2 h-3 w-3/4 rounded bg-white/[0.06]" />
      <div className="mt-1 h-3 w-1/2 rounded bg-white/[0.04]" />
    </div>
  );
}

export default function BuscarClient() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const { results, loading } = useSearch(query);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  const filtered: TMDBItem[] =
    filter === "all"
      ? results
      : results.filter((item) => item.media_type === filter);

  const hasQuery = query.trim().length > 0;

  return (
    <main className="min-h-screen bg-[#020617] text-white">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 md:py-12">

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
              setFilter("all");
            }}
            placeholder="Buscar filmes e séries..."
            autoComplete="off"
            className="
              h-[52px] w-full rounded-2xl border border-white/10
              bg-white/[0.05] pl-12 pr-4 text-base text-white
              placeholder:text-zinc-600 outline-none
              transition focus:border-indigo-500/50 focus:bg-white/[0.07]
              md:h-[56px]
            "
          />
        </div>

        {/* Filtros de tipo (aparecem após digitar) */}
        {hasQuery && (
          <div className="mb-6 flex gap-2">
            {(["all", "movie", "tv"] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`
                  rounded-full border px-4 py-1.5 text-sm font-bold transition
                  ${
                    filter === f
                      ? "border-indigo-500 bg-indigo-500/20 text-indigo-300"
                      : "border-white/10 text-zinc-500 hover:border-white/20 hover:text-zinc-300"
                  }
                `}
              >
                {{ all: "Todos", movie: "Filmes", tv: "Séries" }[f]}
              </button>
            ))}
          </div>
        )}

        {/* Estado vazio — chips de sugestão */}
        {!hasQuery && (
          <div className="py-10 text-center">
            <p className="mb-6 text-zinc-500">O que você quer assistir hoje?</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTION_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => setQuery(chip)}
                  className="
                    rounded-full border border-white/10 bg-white/[0.04]
                    px-4 py-2 text-sm text-zinc-400
                    transition hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-300
                  "
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Skeletons enquanto carrega */}
        {loading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Resultados */}
        {!loading && hasQuery && filtered.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filtered.map((item, i) => (
              <PosterCard
                key={`${item.media_type}-${item.id}`}
                item={item}
                priority={i < 4}
              />
            ))}
          </div>
        )}

        {/* Sem resultados */}
        {!loading && hasQuery && filtered.length === 0 && (
          <div className="py-24 text-center">
            <p className="text-zinc-500">
              Nenhum resultado para &ldquo;{query}&rdquo;
            </p>
            <p className="mt-2 text-sm text-zinc-700">
              Tente outros termos ou verifique a ortografia
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

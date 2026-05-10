"use client";

import { useState, useEffect, useCallback } from "react";
import PosterCard from "@/components/posters/PosterCard";
import type { TMDBItem } from "@/types/tmdb";

type Filter = "popular" | "on_the_air" | "top_rated";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "popular", label: "Populares" },
  { key: "on_the_air", label: "Em exibição" },
  { key: "top_rated", label: "Melhores avaliadas" },
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

export default function SeriesClient() {
  const [filter, setFilter] = useState<Filter>("popular");
  const [items, setItems] = useState<TMDBItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchSeries = useCallback(
    async (type: Filter, pageNum: number, append = false) => {
      if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);

      try {
        const params = new URLSearchParams({
          type,
          media: "tv",
          page: String(pageNum),
        });
        const res = await fetch(`/api/tmdb/list?${params}`);
        if (!res.ok) return;
        const data = await res.json();

        const newItems: TMDBItem[] = (data.results ?? []).map(
          (item: TMDBItem) => ({ ...item, media_type: "tv" as const }),
        );

        setItems((prev) => (append ? [...prev, ...newItems] : newItems));
        setTotalPages(data.total_pages ?? 1);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    setPage(1);
    setItems([]);
    fetchSeries(filter, 1);
  }, [filter, fetchSeries]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchSeries(filter, next, true);
  };

  return (
    <main className="min-h-screen bg-[#020617] text-white">
      {/* Hero */}
      <div className="px-4 pt-8 sm:px-6 md:pt-12">
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl md:text-4xl">
          Séries
        </h1>
        <p className="mt-1 text-sm text-zinc-500 sm:text-base">
          Explore as melhores séries
        </p>
      </div>

      {/* Filtros com scroll horizontal */}
      <div
        className="mt-5 overflow-x-auto px-4 pb-1 sm:px-6"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
      >
        <div className="flex gap-2" style={{ minWidth: "max-content" }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`
                rounded-full border px-4 py-2 text-sm font-bold whitespace-nowrap transition
                ${
                  filter === f.key
                    ? "border-indigo-500 bg-indigo-500/20 text-indigo-300"
                    : "border-white/10 text-zinc-500 hover:border-white/20 hover:text-zinc-300"
                }
              `}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 18 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {items.map((item, i) => (
                <PosterCard
                  key={`tv-${item.id}`}
                  item={item}
                  priority={i < 6}
                />
              ))}
            </div>

            {page < totalPages && (
              <div className="mt-8 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-8 py-3 text-sm font-bold text-zinc-400 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
                >
                  {loadingMore ? "Carregando..." : "Carregar mais"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

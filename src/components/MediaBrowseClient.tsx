"use client";
// src/components/MediaBrowseClient.tsx
// Componente genérico de listagem paginada de filmes ou séries.

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import PosterCard from "@/components/posters/PosterCard";
import { genreHref } from "@/lib/tmdb-index";
import type { TMDBItem, TMDBMediaType } from "@/types/tmdb";

type FilterDef<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  mediaType: TMDBMediaType;
  pageTitle: string;
  pageSubtitle: string;
  filters: readonly FilterDef<K>[];
  defaultFilter: K;
  genres?: readonly { id: number; name: string }[];
};

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[2/3] rounded-[14px] bg-white/[0.06]" />
      <div className="mt-2 h-3 w-3/4 rounded bg-white/[0.06]" />
      <div className="mt-1 h-3 w-1/2 rounded bg-white/[0.04]" />
    </div>
  );
}

export default function MediaBrowseClient<K extends string>({
  mediaType,
  pageTitle,
  pageSubtitle,
  filters,
  defaultFilter,
  genres = [],
}: Props<K>) {
  const [filter, setFilter] = useState<K>(defaultFilter);
  const [items, setItems] = useState<TMDBItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchItems = useCallback(
    async (type: K, pageNum: number, append = false) => {
      if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);

      try {
        const params = new URLSearchParams({
          type,
          media: mediaType,
          page: String(pageNum),
          poster_language: "en_pt",
        });
        const res = await fetch(`/api/tmdb/list?${params}`);
        if (!res.ok) return;
        const data = await res.json();

        const newItems: TMDBItem[] = (data.results ?? []).map(
          (item: TMDBItem) => ({ ...item, media_type: mediaType }),
        );

        setItems((prev) => (append ? [...prev, ...newItems] : newItems));
        setTotalPages(data.total_pages ?? 1);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [mediaType],
  );

  useEffect(() => {
    void Promise.resolve().then(() => fetchItems(filter, 1));
  }, [filter, fetchItems]);

  function handleLoadMore() {
    const next = page + 1;
    setPage(next);
    fetchItems(filter, next, true);
  }

  return (
    <main className="min-h-screen bg-[#020617] pb-28 text-white md:pb-10">
      <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6 md:py-12">

        <div className="mb-6">
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl md:text-4xl">
            {pageTitle}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 sm:text-base">{pageSubtitle}</p>
        </div>

        <div className="mb-8 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:px-6">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setPage(1);
                setFilter(f.key);
              }}
              className={[
                "shrink-0 rounded-full border px-4 py-2 text-sm font-bold transition",
                filter === f.key
                  ? "border-indigo-500 bg-indigo-500/20 text-indigo-300"
                  : "border-white/10 text-zinc-500 hover:border-white/20 hover:text-zinc-300",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>

        {genres.length > 0 && (
          <div className="mb-8">
            <p className="mb-3 text-[10px] font-black uppercase tracking-[0.28em] text-sky-300">
              Explorar por gênero
            </p>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:px-6">
              {genres.map((genre) => (
                <Link
                  key={genre.id}
                  href={genreHref(mediaType, genre.id)}
                  className="shrink-0 rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-xs font-bold text-zinc-400 transition hover:border-sky-300/35 hover:bg-sky-300/[0.10] hover:text-sky-100"
                >
                  {genre.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 15 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {items.map((item, i) => (
                <PosterCard
                  key={`${mediaType}-${item.id}`}
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

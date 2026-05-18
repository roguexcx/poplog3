"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useSearch } from "./useSearch";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import TmdbImage from "@/components/images/TmdbImage";
import { getOriginalTitle, getRating, getReleaseYear, getTitle } from "@/lib/tmdb-utils";

const MAX_VISIBLE = 5;

export default function SearchBar() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const { results, loading } = useSearch(query);
  const visibleResults = results.slice(0, MAX_VISIBLE);

  useEffect(() => {
    setActiveIndex(0);
    setIsOpen(query.trim().length > 0);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function navigateTo(index: number) {
    const item = visibleResults[index];
    if (!item) return;
    setQuery("");
    setIsOpen(false);
    router.push(`/title/${item.media_type ?? "movie"}/${item.id}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { setIsOpen(false); return; }

    if (e.key === "Enter") {
      e.preventDefault();
      if (visibleResults.length > 0) {
        navigateTo(activeIndex);
      } else if (query.trim()) {
        setQuery("");
        setIsOpen(false);
        router.push(`/buscar?q=${encodeURIComponent(query.trim())}`);
      }
      return;
    }

    if (!visibleResults.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i >= visibleResults.length - 1 ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? visibleResults.length - 1 : i - 1));
    }
  }

  const showDropdown = isOpen && (visibleResults.length > 0 || loading);

  return (
    <div ref={containerRef} className="relative z-[80] w-full max-w-2xl">
      <div className="relative">
        <span className="pointer-events-none absolute left-[18px] top-1/2 z-10 -translate-y-1/2 text-sm text-white/30">
          🔎
        </span>
        <input
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-label="Buscar filmes e séries"
          placeholder="Buscar filmes, séries e universos..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (query.trim()) setIsOpen(true); }}
          onKeyDown={handleKeyDown}
          className="h-[52px] w-full rounded-[14px] border border-white/[0.09] bg-white/[0.05] px-[46px] text-[14px] text-white/80 outline-none transition placeholder:text-white/25 focus:border-white/[0.18] focus:bg-white/[0.07]"
        />
      </div>

      {showDropdown && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+10px)] z-[90] overflow-hidden rounded-[14px] border border-white/[0.09] bg-[#0d1120]/95 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
        >
          {loading && (
            <p className="p-4 text-[13px] text-white/30">Buscando...</p>
          )}

          {!loading && visibleResults.length > 0 && visibleResults.map((item, index) => {
            const type = item.media_type ?? "movie";
            const title = getTitle(item);
            const originalTitle = getOriginalTitle(item);
            const year = getReleaseYear(item);
            const rating = getRating(item);
            const posterPath = item.poster_path ?? null;
            const isActive = index === activeIndex;

            return (
              <Link
                key={`${type}-${item.id}`}
                href={`/title/${type}/${item.id}`}
                role="option"
                aria-selected={isActive}
                className={[
                  "flex gap-3 border-b border-white/[0.05] px-4 py-3 transition last:border-b-0",
                  isActive ? "bg-white/[0.06]" : "bg-transparent hover:bg-white/[0.04]",
                ].join(" ")}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => { setQuery(""); setIsOpen(false); }}
              >
                <div className="relative h-[72px] w-12 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                  <TmdbImage
                    path={posterPath}
                    kind="poster"
                    size="card"
                    alt={title}
                    fill
                    sizes="48px"
                    className="object-cover opacity-90"
                    fallback={<div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">—</div>}
                  />
                </div>

                <div className="min-w-0 flex-1 py-1">
                  <LocalizedTitle
                    as="h3"
                    title={title}
                    originalTitle={originalTitle}
                    variant="compact"
                  />
                  <p className="mt-[3px] text-[11px] text-white/35">
                    {type === "movie" ? "Filme" : "Série"}
                    {year !== "----" ? ` · ${year}` : ""}
                  </p>
                  {rating && (
                    <p className="mt-2 text-[11px] font-semibold text-yellow-400/70">★ {rating}</p>
                  )}
                </div>
              </Link>
            );
          })}

          {!loading && visibleResults.length > 0 && (
            <Link
              href={`/buscar?q=${encodeURIComponent(query.trim())}`}
              className="flex items-center justify-center gap-1.5 border-t border-white/[0.05] px-4 py-2.5 text-[11px] text-white/35 transition hover:bg-white/[0.04] hover:text-white/55"
              onClick={() => { setQuery(""); setIsOpen(false); }}
            >
              Ver todos os resultados em Busca →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

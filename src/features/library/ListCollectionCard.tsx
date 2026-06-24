"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, GripVertical, Layers3 } from "lucide-react";

import { TmdbImageLegacy as TmdbImage } from "@/components/images/TmdbImage";
import type { UserListSummary, UserListTitleItem } from "@/types/lists";

type ListCollectionCardProps = {
  list: UserListSummary;
  canMovePrevious?: boolean;
  canMoveNext?: boolean;
  onMovePrevious?: () => void;
  onMoveNext?: () => void;
};

const ROTATION_MS = 4500;

export default function ListCollectionCard({
  list,
  canMovePrevious = false,
  canMoveNext = false,
  onMovePrevious,
  onMoveNext,
}: ListCollectionCardProps) {
  const href = `/u/${encodeURIComponent(list.ownerUsername)}/listas/${list.shortId}-${list.slug}`;

  // Backdrops preferenciais (com fallback para pôster) dos títulos da lista.
  const slides = useMemo<UserListTitleItem[]>(
    () => list.covers.filter((cover) => cover.backdropPath || cover.posterPath),
    [list.covers],
  );

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (slides.length <= 1) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % slides.length);
    }, ROTATION_MS);
    return () => window.clearInterval(interval);
  }, [slides.length]);

  return (
    <article className="group/card relative h-full overflow-hidden rounded-[1.45rem] border border-white/[0.085] bg-white/[0.032] shadow-[0_16px_48px_rgba(0,0,0,0.30)] transition duration-300 hover:-translate-y-1 hover:border-indigo-200/25 hover:bg-white/[0.05] hover:shadow-[0_24px_70px_rgba(0,0,0,0.48)]">
      <Link href={href} className="block h-full p-3" aria-label={`Abrir lista ${list.name}`}>
        <div className="relative aspect-[16/9] overflow-hidden rounded-[1rem] bg-gradient-to-br from-indigo-950/70 to-zinc-950">
          {slides.length > 0 ? (
            <>
              {slides.map((slide, index) => (
                <div
                  key={slide.id}
                  className="absolute inset-0 transition-opacity duration-1000 ease-in-out"
                  style={{ opacity: index === activeIndex ? 1 : 0 }}
                  aria-hidden={index !== activeIndex}
                >
                  <TmdbImage
                    path={slide.backdropPath ?? slide.posterPath}
                    fallbackPath={slide.posterPath}
                    size="w780"
                    alt=""
                    fallbackLabel="POPLOG"
                    className="h-full w-full object-cover brightness-[0.72] saturate-[1.05] transition duration-700 group-hover/card:scale-105 group-hover/card:brightness-[0.88]"
                  />
                </div>
              ))}

              {/* Gradiente para legibilidade do título sobreposto */}
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(6,7,14,0.92)_0%,rgba(6,7,14,0.35)_45%,rgba(6,7,14,0.05)_100%)]" />

              {/* Indicadores de rotação */}
              {slides.length > 1 && (
                <div className="absolute bottom-2 left-3 z-10 flex gap-1">
                  {slides.map((slide, index) => (
                    <span
                      key={slide.id}
                      className={`h-1 rounded-full transition-all duration-500 ${index === activeIndex ? "w-4 bg-white/85" : "w-1.5 bg-white/30"}`}
                    />
                  ))}
                </div>
              )}

              {/* Título sobreposto */}
              <div className="absolute inset-x-0 bottom-0 z-10 p-3">
                <h3 className="truncate text-sm font-black tracking-[-0.025em] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">{list.name}</h3>
                <p className="mt-0.5 text-[11px] font-semibold text-white/55">
                  {list.itemCount} {list.itemCount === 1 ? "título" : "títulos"}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="grid h-full place-items-center text-white/[0.12]">
                <Layers3 className="h-7 w-7" aria-hidden />
              </div>
              <div className="absolute inset-x-0 bottom-0 z-10 p-3">
                <h3 className="truncate text-sm font-black tracking-[-0.025em] text-white/88">{list.name}</h3>
                <p className="mt-0.5 text-[11px] font-medium text-white/36">
                  {list.itemCount} {list.itemCount === 1 ? "título" : "títulos"}
                </p>
              </div>
            </>
          )}
        </div>
      </Link>

      <div className="absolute right-4 top-4 flex items-center gap-1 rounded-full border border-white/[0.10] bg-black/62 p-1 opacity-0 shadow-lg backdrop-blur-md transition group-hover/card:opacity-100 group-focus-within/card:opacity-100">
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onMovePrevious}
          disabled={!canMovePrevious}
          className="grid h-7 w-7 place-items-center rounded-full text-white/55 transition hover:bg-white/[0.10] hover:text-white disabled:opacity-20"
          aria-label={`Mover ${list.name} para a esquerda`}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <span className="grid h-7 w-6 place-items-center text-white/35" aria-hidden>
          <GripVertical className="h-4 w-4" aria-hidden />
        </span>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onMoveNext}
          disabled={!canMoveNext}
          className="grid h-7 w-7 place-items-center rounded-full text-white/55 transition hover:bg-white/[0.10] hover:text-white disabled:opacity-20"
          aria-label={`Mover ${list.name} para a direita`}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}

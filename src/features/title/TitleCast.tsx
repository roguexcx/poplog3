"use client";

import Image from "next/image";
import { resolveForRender } from "@/lib/images/proxy";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import SectionHeader from "@/components/ui/SectionHeader";

import type { TitleCastMember } from "./types";

type TitleCastProps = {
  cast?: TitleCastMember[];
};

const SCROLL_AMOUNT = 480;

export default function TitleCast({ cast }: TitleCastProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const update = () => {
      setCanScrollLeft(el.scrollLeft > 2);
      setCanScrollRight(
        el.scrollLeft + el.clientWidth < el.scrollWidth - 2
      );
    };

    update();
    el.addEventListener("scroll", update, { passive: true });

    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [cast]);

  if (!cast || cast.length === 0) return null;

  function scrollBy(direction: "left" | "right") {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction === "left" ? -SCROLL_AMOUNT : SCROLL_AMOUNT,
      behavior: "smooth",
    });
  }

  return (
    <section className="flex flex-col gap-4 sm:gap-5">
      <SectionHeader
        eyebrow="Elenco principal"
        title="Quem dá vida a esta história"
        accent="indigo"
      />

      <div className="relative">
        {/* Seta esquerda */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollBy("left")}
            aria-label="Rolar elenco para a esquerda"
            className="absolute left-1 top-1/2 z-[3] grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/[0.14] bg-black/72 text-white/85 shadow-[0_12px_36px_rgba(0,0,0,0.45)] backdrop-blur-md transition hover:border-white/[0.28] hover:bg-black/82 hover:text-white"
          >
            <span className="text-base leading-none" aria-hidden>
              ‹
            </span>
          </button>
        )}

        {/* Seta direita */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollBy("right")}
            aria-label="Rolar elenco para a direita"
            className="absolute right-1 top-1/2 z-[3] grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/[0.14] bg-black/72 text-white/85 shadow-[0_12px_36px_rgba(0,0,0,0.45)] backdrop-blur-md transition hover:border-white/[0.28] hover:bg-black/82 hover:text-white"
          >
            <span className="text-base leading-none" aria-hidden>
              ›
            </span>
          </button>
        )}

        <div
          ref={trackRef}
          className="-mx-1 flex gap-3 overflow-x-auto scroll-smooth px-1 pb-2 sm:gap-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {cast.map((person, i) => (
            <Link
              key={`${person.id}-${i}`}
              href={`/person/${person.id}`}
              className="group relative flex w-[120px] shrink-0 flex-col sm:w-[140px]"
            >
              <article className="relative">
                <div className="relative overflow-hidden rounded-[1.1rem] border border-white/[0.08] bg-white/[0.04] shadow-[0_14px_42px_rgba(0,0,0,0.36)] transition duration-300 group-hover:-translate-y-1 group-hover:border-white/[0.16] group-hover:bg-white/[0.07]">
                  <div className="relative aspect-[3/4] overflow-hidden bg-white/[0.04]">
                    {person.photoUrl ? (
                      <Image
                        src={resolveForRender(person.photoUrl) ?? person.photoUrl}
                        alt={person.name}
                        fill
                        unoptimized
                        sizes="160px"
                        className="object-cover brightness-[0.92] saturate-[1.06] transition duration-500 group-hover:scale-[1.04] group-hover:brightness-100"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-gradient-to-br from-zinc-900 to-zinc-950 text-[10px] uppercase tracking-[0.2em] text-white/35">
                        Sem foto
                      </div>
                    )}
                    <div
                      className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/72 via-black/12 to-transparent"
                      aria-hidden
                    />
                    <div
                      className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_115%,rgba(99,102,241,0.30),transparent_58%)] opacity-0 transition duration-500 group-hover:opacity-100"
                      aria-hidden
                    />
                  </div>
                </div>

                <div className="px-1 pt-3">
                  <p className="line-clamp-1 text-[13px] font-semibold tracking-[-0.01em] text-white/92 transition group-hover:text-white">
                    {person.name}
                  </p>
                  {person.character && (
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-white/45">
                      {person.character}
                    </p>
                  )}
                </div>
              </article>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

"use client";

import { useRef } from "react";

import PosterCard from "@/components/posters/PosterCard";
import SectionHeader from "@/components/layout/SectionHeader";

import type { TMDBItem } from "@/types/tmdb";

type HomeSectionProps = {
  title: string;
  items: TMDBItem[];
  subtitle?: string;
};

export default function HomeSection({
  title,
  items,
  subtitle,
}: HomeSectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!items.length) return null;

  function scroll(direction: "left" | "right") {
    if (!scrollRef.current) return;

    const amount = scrollRef.current.clientWidth * 0.82;

    scrollRef.current.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  }

  return (
    <section className="relative space-y-5">
      <SectionHeader
        title={title}
        subtitle={subtitle}
        action={
          <div className="hidden items-center gap-2 md:flex">
            <button
              type="button"
              onClick={() => scroll("left")}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-sm text-zinc-300 backdrop-blur-md transition hover:bg-white/[0.08] hover:text-white"
            >
              ←
            </button>

            <button
              type="button"
              onClick={() => scroll("right")}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-sm text-zinc-300 backdrop-blur-md transition hover:bg-white/[0.08] hover:text-white"
            >
              →
            </button>
          </div>
        }
      />

      <div
        ref={scrollRef}
        className="no-scrollbar overflow-x-auto scroll-smooth pb-2"
        style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
      >
        <div className="flex gap-3 pl-1 pr-4 md:gap-5 md:pl-[2px] md:pr-[2px]">
          {items.map((item, index) => (
            <div
              key={`${item.media_type}-${item.id}`}
              className="
                w-[148px]
                shrink-0
                sm:w-[160px]
                md:w-[172px]
                lg:w-[182px]
              "
            >
              <PosterCard item={item} priority={index < 5} />
            </div>
          ))}
          <div className="w-1 shrink-0" />
        </div>
      </div>
    </section>
  );
}
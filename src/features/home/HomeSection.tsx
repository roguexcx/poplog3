"use client";

import PosterCard from "@/components/posters/PosterCard";
import SectionHeader from "@/components/layout/SectionHeader";
import { ScrollRowArrows } from "@/components/ScrollRowArrows";
import { useScrollRow } from "@/hooks/useScrollRow";

import type { TMDBItem } from "@/types/tmdb";

type HomeSectionProps = {
  title: string;
  items: TMDBItem[];
  subtitle?: string;
};

export default function HomeSection({ title, items, subtitle }: HomeSectionProps) {
  const { ref, canScrollLeft, canScrollRight, scrollLeft, scrollRight } = useScrollRow();

  if (!items.length) return null;

  return (
    <section className="relative space-y-5">
      <SectionHeader
        title={title}
        subtitle={subtitle}
        action={
          <div className="hidden md:flex">
            <ScrollRowArrows
              canScrollLeft={canScrollLeft}
              canScrollRight={canScrollRight}
              onLeft={scrollLeft}
              onRight={scrollRight}
            />
          </div>
        }
      />

      <div
        ref={ref}
        className="no-scrollbar overflow-x-auto scroll-smooth pb-2"
        style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
      >
        <div className="flex gap-3 pl-1 pr-4 md:gap-5 md:pl-[2px] md:pr-[2px]">
          {items.map((item, index) => (
            <div
              key={`${item.media_type}-${item.id}`}
              className="w-[148px] shrink-0 sm:w-[160px] md:w-[172px] lg:w-[182px]"
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

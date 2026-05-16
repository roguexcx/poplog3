import type { Poplog3UserLibraryItem } from "@/server/library/library-service";

import LibraryPosterCard from "./LibraryPosterCard";

type LibraryGridProps = {
  items: Poplog3UserLibraryItem[];
};

export default function LibraryGrid({ items }: LibraryGridProps) {
  return (
    <div className="relative rounded-[2rem] border border-white/[0.06] bg-white/[0.018] p-3 shadow-[0_24px_90px_rgba(0,0,0,0.28)] backdrop-blur-sm sm:p-4 md:rounded-[2.25rem] md:p-5">
      <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/14 to-transparent" />

      <div className="relative grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
        {items.map((item, index) => (
          <LibraryPosterCard key={item.id} item={item} priority={index < 10} />
        ))}
      </div>
    </div>
  );
}

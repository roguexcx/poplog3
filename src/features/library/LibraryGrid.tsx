import type { Poplog3UserLibraryItem } from "@/server/library/library-service";

import LibraryPosterCard from "./LibraryPosterCard";

type LibraryGridProps = {
  items: Poplog3UserLibraryItem[];
};

export default function LibraryGrid({ items }: LibraryGridProps) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {items.map((item, index) => (
        <LibraryPosterCard key={item.id} item={item} priority={index < 10} />
      ))}
    </div>
  );
}
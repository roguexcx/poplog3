import type { Poplog3UserLibraryItem } from "@/server/library/library-service";

import LibraryPosterCard from "./LibraryPosterCard";

type LibraryGridProps = {
  items: Poplog3UserLibraryItem[];
  listMembership?: Record<string, string[]>;
};

export default function LibraryGrid({ items, listMembership = {} }: LibraryGridProps) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-3">
      {items.map((item, index) => (
        <LibraryPosterCard
          key={item.id}
          item={item}
          priority={index < 10}
          inCustomList={Boolean(listMembership[`${item.tmdb_id}:${item.media_type}`]?.length)}
        />
      ))}
    </div>
  );
}

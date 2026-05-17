import type { Poplog3UserLibraryItem } from "@/server/library/library-service";

import LibraryPosterCard from "./LibraryPosterCard";

type LibraryGridProps = {
  items: Poplog3UserLibraryItem[];
};

export default function LibraryGrid({ items }: LibraryGridProps) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
    >
      {items.map((item, index) => (
        <LibraryPosterCard key={item.id} item={item} priority={index < 10} />
      ))}
    </div>
  );
}

import PosterCard from "@/components/posters/PosterCard";
import type { TMDBItem } from "@/types/tmdb";

type Props = {
  items: TMDBItem[];
  emptyText?: string;
  columns?: "compact" | "wide";
};

export default function IndexedTitleGrid({
  items,
  emptyText = "Nenhum título encontrado por enquanto.",
  columns = "wide",
}: Props) {
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-6 text-sm font-semibold text-zinc-500">
        {emptyText}
      </div>
    );
  }

  return (
    <div className={columns === "compact"
      ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
    }>
      {items.map((item, index) => (
        <PosterCard key={`${item.media_type ?? "movie"}-${item.id}`} item={item} priority={index < 8} />
      ))}
    </div>
  );
}

"use client";

import InteractivePosterCard from "@/components/ui/InteractivePosterCard";

type PersonTitle = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  original_title?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
};

function getYear(title: PersonTitle) {
  const date = title.release_date ?? title.first_air_date;
  if (!date) return undefined;
  const year = new Date(date).getFullYear();
  return Number.isFinite(year) ? year : undefined;
}

export default function PersonTitleGrid({ titles }: { titles: PersonTitle[] }) {
  if (!titles.length) return null;

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4 lg:grid-cols-6">
      {titles.map((title) => (
        <InteractivePosterCard
          key={`${title.media_type}-${title.tmdb_id}`}
          id={title.tmdb_id}
          href={`/title/${title.media_type}/${title.tmdb_id}`}
          mediaType={title.media_type}
          title={title.title}
          originalTitle={title.original_title}
          posterPath={title.poster_path}
          fallbackPath={title.backdrop_path}
          year={getYear(title)}
          source="person"
        />
      ))}
    </div>
  );
}

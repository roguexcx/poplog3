import PosterCard from "@/components/ui/PosterCard";
import SectionHeader from "@/components/ui/SectionHeader";

import type { TitleRecommendation } from "./types";

type TitleRecommendationsProps = {
  recommendations?: TitleRecommendation[];
};

export default function TitleRecommendations({
  recommendations,
}: TitleRecommendationsProps) {
  if (!recommendations || recommendations.length === 0) return null;

  return (
    <section className="flex flex-col gap-4 sm:gap-5">
      <SectionHeader
        eyebrow="Recomendações"
        title="Mais como este"
        subtitle="Selecionadas a partir do mesmo universo cinematográfico, ritmo e atmosfera."
        accent="rose"
      />

      <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {recommendations.map((item) => (
          <PosterCard
            key={`${item.mediaType}-${item.id}`}
            posterPath={item.posterPath ?? null}
            title={item.title}
            year={item.year ?? null}
            mediaType={item.mediaType}
            href={`/title/${item.mediaType}/${item.id}`}
            accent="rose"
          />
        ))}
      </div>
    </section>
  );
}

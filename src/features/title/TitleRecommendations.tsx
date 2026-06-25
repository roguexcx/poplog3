import { uiMessage } from "@/lib/i18n/ui-message";
import InteractivePosterCard from "@/components/ui/InteractivePosterCard";
import SectionHeader from "@/components/ui/SectionHeader";
import type { TitleRecommendation } from "./types";
type TitleRecommendationsProps = {
    recommendations?: TitleRecommendation[];
};
export default function TitleRecommendations({ recommendations, }: TitleRecommendationsProps) {
    if (!recommendations || recommendations.length === 0)
        return null;
    return (<section className="flex flex-col gap-4 sm:gap-5">
      <SectionHeader eyebrow={uiMessage("ui.96ce1b809d20")} title={uiMessage("ui.53c505a0e40b")} subtitle={uiMessage("ui.a610f539c6ec")} accent="rose"/>

      <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {recommendations.map((item) => (<InteractivePosterCard key={`${item.mediaType}-${item.id}`} id={item.id} tmdbId={item.tmdbId ?? null} poplogId={item.poplogId ?? null} imdbId={item.imdbId ?? null} slug={item.slug ?? null} posterPath={item.posterPath ?? null} title={item.title} originalTitle={item.originalTitle ?? null} year={item.year ?? null} mediaType={item.mediaType} href={`/title/${item.mediaType}/${item.poplogId ?? item.id}`} accent="rose" source="recommendations" bestProviderName={item.best_provider_name ?? null} bestProviderType={item.best_provider_type ?? null} bestProviderLogo={item.best_provider_logo ?? null}/>))}
      </div>
    </section>);
}


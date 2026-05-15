import TitleCast from "./TitleCast";
import TitleEpisodeBrowser from "./TitleEpisodeBrowser";
import TitleHero from "./TitleHero";
import TitleMetadata from "./TitleMetadata";
import TitleProviders from "./TitleProviders";
import TitleRecommendations from "./TitleRecommendations";
import TitleScoreCard from "./TitleScoreCard";
import TitleSeasonsCard from "./TitleSeasonsCard";
import TitleSyncBar from "./TitleSyncBar";
import TitleTrailer from "./TitleTrailer";

import type { TitlePageData } from "./types";

type TitlePageViewProps = {
  title: TitlePageData;
};

export default function TitlePageView({ title }: TitlePageViewProps) {
  const hasTrailer = Boolean(title.trailer);
  const hasRatings = Boolean(title.ratings);
  const hasMetadata = Boolean(title.metadata);

  const hasSeasonsBlock =
    title.mediaType === "tv" &&
    (title.numberOfSeasons !== null ||
      title.numberOfEpisodes !== null ||
      title.nextEpisode?.air_date);

  const seasons = title.seasons ?? [];

  const showEpisodeBrowser =
    title.mediaType === "tv" && seasons.length > 0;

  const seasonNumbers = new Set(seasons.map((s) => s.seasonNumber));

  const initialSeason = (() => {
    const userNext = title.userSeriesProgress?.nextEpisode?.seasonNumber;

    if (typeof userNext === "number" && seasonNumbers.has(userNext)) {
      return userNext;
    }

    const next = title.nextEpisode?.season_number;

    if (typeof next === "number" && seasonNumbers.has(next)) {
      return next;
    }

    return null;
  })();

  return (
    <main className="relative min-h-screen overflow-x-clip text-white">
      <TitleHero title={title} />

      <section className="mx-auto w-full max-w-[1600px] px-5 pb-24 pt-8 sm:px-8 sm:pt-10 md:px-12 md:pt-12 lg:px-16">
        <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px] xl:gap-10">
          <div className="flex min-w-0 flex-col gap-8 sm:gap-10 lg:gap-12">
            {hasSeasonsBlock && <TitleSeasonsCard title={title} />}

            {showEpisodeBrowser && typeof title.id === "number" && (
              <TitleEpisodeBrowser
                seriesTmdbId={title.id}
                seasons={seasons}
                initialSeason={initialSeason}
                initialProgress={title.userSeriesProgress ?? null}
              />
            )}

            <TitleCast cast={title.cast} />

            {hasMetadata && (
              <TitleMetadata
                metadata={title.metadata}
                mediaType={title.mediaType}
              />
            )}

            <TitleRecommendations recommendations={title.recommendations} />
          </div>

          <aside className="flex min-w-0 flex-col gap-5 sm:gap-6 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:self-start lg:pr-1">
            {hasTrailer && title.trailer && (
              <TitleTrailer trailer={title.trailer} />
            )}

            {hasRatings && <TitleScoreCard ratings={title.ratings} />}

            <TitleProviders providers={title.providers} />
          </aside>
        </div>
      </section>

      <TitleSyncBar
        lastSyncedAt={title.lastSyncedAt ?? null}
        cacheInfo={title.cacheInfo ?? null}
      />
    </main>
  );
}
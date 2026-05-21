"use client";

import { useState } from "react";

import { buildFinancialBadgeInsight } from "@/lib/editorial-finance";

import TitleCast from "./TitleCast";
import TitleCommunityHighlights from "./TitleCommunityHighlights";
import TitleCollectionSection from "./TitleCollectionSection";
import TitleEpisodeBrowser from "./TitleEpisodeBrowser";
import TitleFinancialBadge from "./TitleFinancialBadge";
import TitleHero from "./TitleHero";
import TitleMetadata from "./TitleMetadata";
import MovieSocialModal from "./MovieSocialModal";
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
  const [movieSocialOpen, setMovieSocialOpen] = useState(false);

  const hasTrailer = Boolean(title.trailer);
  const hasRatings = Boolean(title.ratings);
  const hasMetadata = Boolean(title.metadata);

  const isMovie = title.mediaType === "movie";

  const financialInsight = isMovie
    ? buildFinancialBadgeInsight({
        budget: title.metadata?.budget,
        revenue: title.metadata?.revenue,
      })
    : null;

  const hasSeasonsBlock =
    title.mediaType === "tv" &&
    (title.numberOfSeasons !== null ||
      title.numberOfEpisodes !== null ||
      title.nextEpisode?.air_date);

  const seasons = title.seasons ?? [];

  const showEpisodeBrowser = title.mediaType === "tv" && seasons.length > 0;

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
    <div className="relative text-white">
      <TitleHero
        title={title}
        onOpenMovieSocial={
          isMovie ? () => setMovieSocialOpen(true) : undefined
        }
      />

      <section className="mx-auto w-full max-w-[1600px] px-5 pb-24 pt-8 sm:px-8 sm:pt-10 md:px-12 md:pt-12 lg:px-16">
        <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px] xl:gap-10">
          <div className="flex min-w-0 flex-col gap-8 sm:gap-10 lg:gap-12">
            {hasSeasonsBlock && <TitleSeasonsCard title={title} />}

            {showEpisodeBrowser && typeof title.id === "number" && (
              <TitleEpisodeBrowser
                seriesTmdbId={title.id}
                seriesName={title.title}
                seasons={seasons}
                initialSeason={initialSeason}
                initialProgress={title.userSeriesProgress ?? null}
              />
            )}

            {isMovie && <TitleFinancialBadge insight={financialInsight} />}

            <TitleCast cast={title.cast} />

            <TitleCollectionSection
              collection={title.metadata?.collection ?? null}
              currentTitleId={typeof title.id === "number" ? title.id : null}
            />

            {isMovie && (
              <TitleCommunityHighlights
                movieTmdbId={Number(title.id)}
                movieTitle={title.title}
                onOpenAll={() => setMovieSocialOpen(true)}
              />
            )}

            <TitleRecommendations recommendations={title.recommendations} />
          </div>

          <aside className="flex min-w-0 flex-col gap-5 sm:gap-6 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:self-start lg:pr-1">
            {hasTrailer && title.trailer && (
              <TitleTrailer trailer={title.trailer} title={title.title} />
            )}

            {hasRatings && <TitleScoreCard ratings={title.ratings} />}

            <TitleProviders providers={title.providers} />

            {hasMetadata && (
              <TitleMetadata
                metadata={title.metadata}
                mediaType={title.mediaType}
              />
            )}
          </aside>
        </div>
      </section>

      {isMovie && movieSocialOpen && typeof title.id === "number" && (
        <MovieSocialModal
          movieTmdbId={Number(title.id)}
          movieTitle={title.title}
          overview={title.overview ?? null}
          backdropUrl={title.backdropUrl ?? null}
          year={title.year ?? null}
          runtime={typeof title.runtime === "number" ? `${title.runtime} min` : null}
          voteAverage={title.voteAverage ?? null}
          watched={Boolean(title.userState?.watched)}
          saving={false}
          onToggleWatched={() => {}}
          onClose={() => setMovieSocialOpen(false)}
        />
      )}

      <TitleSyncBar
        lastSyncedAt={title.lastSyncedAt ?? null}
        cacheInfo={title.cacheInfo ?? null}
      />
    </div>
  );
}

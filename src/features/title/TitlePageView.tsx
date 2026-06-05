"use client";

import { useState } from "react";

import { buildFinancialBadgeInsight } from "@/lib/editorial-finance";
import { getGeneralIndex } from "@/lib/ratings/general-index";

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
import TitleSeasonsCard from "./TitleSeasonsCard";
import TitleSyncBar from "./TitleSyncBar";
import TitleTrailer from "./TitleTrailer";
import UserRatingWidget from "./UserRatingWidget";

import type { TitlePageData } from "./types";
import type { CommunityRatingData } from "@/types/user";

type TitlePageViewProps = {
  title: TitlePageData;
};

export default function TitlePageView({ title }: TitlePageViewProps) {
  const [movieSocialOpen, setMovieSocialOpen] = useState(false);
  const [communityRating, setCommunityRating] =
    useState<CommunityRatingData | null>(title.communityRating ?? null);

  const generalIndex = getGeneralIndex({
    communityRating,
    ratings: title.ratings ?? null,
  });

  const liveTitle: TitlePageData = {
    ...title,
    communityRating,
    generalIndex,
  };

  const hasTrailer = Boolean(title.trailer);
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

  // Episode browser requires real TMDB season data in the DB.
  // Synthetic (negative) IDs have no TMDB rows, so seasons are stubs only.
  const hasRealTmdbId = typeof title.externalIds?.tmdbId === "number";
  const showEpisodeBrowser = title.mediaType === "tv" && seasons.length > 0 && hasRealTmdbId;

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
        title={liveTitle}
        onOpenMovieSocial={
          isMovie ? () => setMovieSocialOpen(true) : undefined
        }
      />

      <section className="mx-auto w-full max-w-[1600px] px-5 pb-24 pt-8 sm:px-8 sm:pt-10 md:px-12 md:pt-12 lg:px-16">
        <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_460px] xl:gap-10">
          <div className="flex min-w-0 flex-col gap-8 sm:gap-10 lg:gap-12">
            {hasSeasonsBlock && <TitleSeasonsCard title={title} />}

            {showEpisodeBrowser && (
              <TitleEpisodeBrowser
                seriesTmdbId={
                  title.externalIds?.tmdbId ??
                  (typeof title.id === "number" && title.id > 0 ? title.id : null) ??
                  title.externalIds?.imdbId ??
                  title.poplogId ??
                  title.id
                }
                seriesName={title.title}
                seasons={seasons}
                initialSeason={initialSeason}
                initialProgress={title.userSeriesProgress ?? null}
                isAuthenticated={Boolean(title.userState?.isAuthenticated)}
                onSeriesCommunityRatingChange={setCommunityRating}
              />
            )}

            {isMovie && <TitleFinancialBadge insight={financialInsight} />}

            {isMovie && (title.externalIds?.tmdbId ?? (typeof title.id === "number" ? title.id : 0)) > 0 && (
              <TitleCommunityHighlights
                movieTmdbId={title.externalIds?.tmdbId ?? (typeof title.id === "number" ? title.id : 0)}
                movieTitle={title.title}
                onOpenAll={() => setMovieSocialOpen(true)}
              />
            )}

            <TitleCast cast={title.cast} />

            <TitleCollectionSection
              collection={title.metadata?.collection ?? null}
              currentTitleId={
                title.externalIds?.tmdbId ??
                (typeof title.id === "number" ? title.id : null)
              }
            />

            <TitleRecommendations recommendations={title.recommendations} />
          </div>

          <aside className="flex min-w-0 flex-col gap-5 sm:gap-6 lg:sticky lg:top-6 lg:self-start">
            {/* Avaliação POPLOG */}
            <UserRatingWidget
              mediaType={title.mediaType}
              tmdbId={
                title.externalIds?.tmdbId ??
                (typeof title.id === "number" && title.id !== 0 ? title.id : 0)
              }
              poplogId={title.poplogId ?? null}
              imdbId={title.externalIds?.imdbId ?? null}
              slug={title.externalIds?.slug ?? null}
              userRating={title.userState?.userRating ?? null}
              communityRating={communityRating}
              ratings={title.ratings ?? null}
              isAuthenticated={Boolean(title.userState?.isAuthenticated)}
              onCommunityRatingChange={setCommunityRating}
            />

            <TitleProviders providers={title.providers} />

            {hasTrailer && title.trailer && (
              <TitleTrailer trailer={title.trailer} title={title.title} />
            )}

            {hasMetadata && (
              <TitleMetadata
                metadata={title.metadata}
                mediaType={title.mediaType}
              />
            )}
          </aside>
        </div>
      </section>

      {isMovie && movieSocialOpen && (title.externalIds?.tmdbId ?? (typeof title.id === "number" ? title.id : 0)) > 0 && (
        <MovieSocialModal
          movieTmdbId={title.externalIds?.tmdbId ?? (typeof title.id === "number" ? title.id : 0)}
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

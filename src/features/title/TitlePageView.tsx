"use client";

import { useState } from "react";

import TitleCast from "./TitleCast";
import TitleEpisodeBrowser from "./TitleEpisodeBrowser";
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
    <main className="relative min-h-screen overflow-x-clip text-white">
      <TitleHero
        title={title}
        onOpenMovieSocial={
          isMovie ? () => setMovieSocialOpen(true) : undefined
        }
      />

{isMovie && (
  <section className="relative z-10 -mt-8 mb-2 px-5 sm:px-8 md:px-12 lg:px-16">
    <div className="mx-auto max-w-[1180px]">
      <button
        type="button"
        onClick={() => setMovieSocialOpen(true)}
        className="group flex w-full items-center justify-between overflow-hidden rounded-[1.6rem] border border-fuchsia-300/14 bg-[linear-gradient(135deg,rgba(217,70,239,0.10),rgba(99,102,241,0.08))] p-4 backdrop-blur-xl transition hover:border-fuchsia-300/24 hover:bg-[linear-gradient(135deg,rgba(217,70,239,0.14),rgba(99,102,241,0.12))]"
      >
        <div className="flex items-center gap-4">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-fuchsia-500/14">
            <span className="absolute inset-0 animate-ping rounded-full bg-fuchsia-500/18" />
            <span className="relative h-3 w-3 rounded-full bg-fuchsia-300" />
          </div>

          <div className="text-left">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-fuchsia-300/55">
              Contexto social
            </p>

            <h3 className="mt-1 text-[15px] font-bold tracking-[-0.02em] text-white/92">
              Veja como o público está reagindo ao filme
            </h3>

            <p className="mt-1 text-[12px] text-white/42">
              Comentários reais traduzidos automaticamente para PT-BR
            </p>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/55 transition group-hover:border-white/[0.16] group-hover:bg-white/[0.08] group-hover:text-white/82 sm:flex">
          Abrir
          <span aria-hidden>→</span>
        </div>
      </button>
    </div>
  </section>
)}

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

      {isMovie && movieSocialOpen && typeof title.id === "number" && (
  <MovieSocialModal
    movieTmdbId={Number(title.id)}
    movieTitle={title.title}
    overview={title.overview ?? null}
    backdropUrl={title.backdropUrl ?? null}
    year={title.year ?? null}
    runtime={
      typeof title.runtime === "number"
        ? `${title.runtime} min`
        : null
    }
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
    </main>
  );
}
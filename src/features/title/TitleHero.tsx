import Image from "next/image";

import {
  availabilityStateToBadgeVariant,
  formatAvailabilityState,
} from "@/lib/series";

import {
  formatEpisodeRuntimeLabel,
  formatRuntimeLabel,
} from "@/lib/domain-labels";

import StatusBadge from "@/components/ui/StatusBadge";

import TitleActions from "./TitleActions";
import SeriesProgressChip from "./SeriesProgressChip";
import type { TitlePageData } from "./types";

type TitleHeroProps = {
  title: TitlePageData;
  onOpenMovieSocial?: () => void;
};

function formatYearSpan(t: TitlePageData) {
  if (t.mediaType === "movie") return t.year ?? null;

  const startYear =
    t.firstAirDate?.slice(0, 4) ??
    (typeof t.year === "number" ? String(t.year) : t.year);

  const endYear = t.lastAirDate?.slice(0, 4);

  if (!startYear) return null;
  if (endYear && endYear !== startYear) return `${startYear} – ${endYear}`;

  return startYear;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export default function TitleHero({
  title,
  onOpenMovieSocial,
}: TitleHeroProps) {
  const runtime =
    title.mediaType === "tv"
      ? formatEpisodeRuntimeLabel(title.episodeRunTimeMinutes, {
          estimated: title.runtimeEstimated,
        })
      : formatRuntimeLabel(title.runtime);

  const yearSpan = formatYearSpan(title);

  const stateLabel = title.availabilityState
    ? formatAvailabilityState(title.availabilityState)
    : null;

  const stateVariant = title.availabilityState
    ? availabilityStateToBadgeVariant(title.availabilityState)
    : "neutral";

  const poplogScore =
    typeof title.ratings?.poplogScore === "number"
      ? title.ratings.poplogScore
      : null;

  const tmdbScore =
    typeof title.voteAverage === "number" ? title.voteAverage : null;

  const progress = title.userSeriesProgress ?? null;

  const watchedCount = progress?.watchedCount ?? 0;

  const totalEpisodes = progress?.totalEpisodes ?? null;

  // airedEpisodes é o denominador correto para progresso — nunca inclui episódios futuros
  const airedEpisodes = progress?.airedEpisodes ?? totalEpisodes;

  const hasProgress =
    title.mediaType === "tv" && watchedCount > 0;

  const isWatching =
    title.mediaType === "tv" &&
    (title.userState?.watching === true ||
      title.userState?.computedState === "in_progress" ||
      title.userState?.computedState === "up_to_date" ||
      title.userState?.computedState === "completed");

  const showProgressBlock = hasProgress || isWatching;

  const hasSeasons =
    typeof title.seasons !== "undefined" &&
    title.seasons.filter((s) => s.seasonNumber > 0 && (s.episodeCount ?? 0) > 0).length > 0;

  const isAuthenticated = title.userState?.isAuthenticated === true;

  const computedState =
    title.userState?.computedState ?? null;

  const isComplete =
    computedState === "completed" ||
    computedState === "up_to_date" ||
    (hasProgress &&
      typeof airedEpisodes === "number" &&
      watchedCount >= airedEpisodes);

  const nextEpUser = progress?.nextEpisode ?? null;

  // Progresso de temporada — usa a temporada onde o usuário está (nextEpisode)
  const currentSeasonNumber = !isComplete ? (nextEpUser?.seasonNumber ?? null) : null;
  const currentSeasonTotal =
    currentSeasonNumber != null
      ? (title.seasons?.find((s) => s.seasonNumber === currentSeasonNumber)?.episodeCount ?? null)
      : null;
  const currentSeasonWatched =
    currentSeasonNumber != null && nextEpUser != null
      ? Math.max(0, nextEpUser.episodeNumber - 1)
      : null;

  const progressPct = (() => {
    // Em progresso: usa percentual da temporada atual
    if (
      !isComplete &&
      currentSeasonTotal != null &&
      currentSeasonTotal > 0 &&
      currentSeasonWatched != null
    ) {
      return Math.min(100, Math.round((currentSeasonWatched / currentSeasonTotal) * 100));
    }
    // Concluída / up_to_date: usa percentual da série inteira
    if (typeof airedEpisodes === "number" && airedEpisodes > 0) {
      return Math.min(100, Math.round((watchedCount / airedEpisodes) * 100));
    }
    return null;
  })();

  return (
    <section className="-mx-4 -mt-4 relative isolate min-h-[88vh] overflow-hidden sm:-mx-6 md:-mx-8 md:-mt-6 lg:-mx-10">
      {title.backdropUrl && (
        <div className="absolute inset-0 -z-10">
          <Image
            src={title.backdropUrl}
            alt=""
            fill
            priority
            quality={100}
            sizes="100vw"
            className="object-cover object-center brightness-[0.78] contrast-[1.08] saturate-[1.18]"
          />
        </div>
      )}

      <div
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_15%_30%,rgba(34,211,238,0.16),transparent_42%),radial-gradient(circle_at_85%_70%,rgba(244,114,182,0.12),transparent_38%)]"
        aria-hidden
      />

      <div
        className="absolute inset-0 -z-10 bg-gradient-to-b from-[#020617]/65 via-[#020617]/55 to-[#020617]/95"
        aria-hidden
      />

      <div
        className="absolute inset-y-0 left-0 -z-10 w-[55%] bg-gradient-to-r from-[#020617]/85 via-[#020617]/55 to-transparent"
        aria-hidden
      />

      <div
        className="absolute inset-x-0 bottom-0 -z-10 h-[55vh] bg-gradient-to-t from-[#020617] via-[#020617]/80 to-transparent"
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-[88vh] w-full max-w-[1600px] flex-col justify-end gap-8 px-5 pb-12 pt-28 sm:px-8 sm:pb-16 sm:pt-32 md:px-12 md:pb-20 lg:px-16">
        <div className="grid min-w-0 items-end gap-8 md:grid-cols-[260px_minmax(0,1fr)] md:gap-10 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="relative hidden md:block">
            <div className="absolute -inset-3 -z-10 rounded-[2rem] bg-gradient-to-br from-cyan-300/20 via-indigo-400/12 to-fuchsia-400/14 opacity-70 blur-2xl" />

            <div className="overflow-hidden rounded-[1.5rem] border border-white/[0.10] bg-zinc-900/70 shadow-[0_28px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
              {title.posterUrl ? (
                <Image
                  src={title.posterUrl}
                  alt={title.title}
                  width={640}
                  height={960}
                  className="aspect-[2/3] w-full object-cover"
                />
              ) : (
                <div className="grid aspect-[2/3] w-full place-items-center text-xs uppercase tracking-[0.2em] text-white/40">
                  Sem poster
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-2 sm:mb-5 sm:gap-2.5">
              <span className="rounded-full border border-white/[0.10] bg-white/[0.06] px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/72 backdrop-blur-md">
                {title.mediaType === "movie" ? "Filme" : "Série"}
              </span>

              {stateLabel && stateLabel !== "—" && (
                <StatusBadge
                  variant={stateVariant}
                  label={stateLabel}
                  size="sm"
                />
              )}

              {yearSpan && (
                <span className="rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/70 backdrop-blur-md">
                  {yearSpan}
                </span>
              )}

              {runtime && (
                <span className="rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/70 backdrop-blur-md">
                  {runtime}
                </span>
              )}

              {typeof title.numberOfSeasons === "number" &&
                title.numberOfSeasons > 0 && (
                  <span className="rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-white/70 backdrop-blur-md">
                    {title.numberOfSeasons}{" "}
                    {title.numberOfSeasons === 1
                      ? "temporada"
                      : "temporadas"}
                  </span>
                )}

              {poplogScore !== null ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-black tracking-[-0.01em] text-cyan-100 backdrop-blur-md">
                  <span className="text-[8px] font-black uppercase tracking-[0.2em] text-cyan-200/80">
                    POPLOG
                  </span>

                  <span>{poplogScore.toFixed(1)}</span>
                </span>
              ) : (
                tmdbScore !== null && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/22 bg-amber-400/12 px-3 py-1 text-[11px] font-black text-amber-100 backdrop-blur-md">
                    <span aria-hidden>★</span>
                    {tmdbScore.toFixed(1)}
                  </span>
                )
              )}
            </div>

            <h1 className="break-words text-[clamp(1.875rem,5vw,4.25rem)] font-black leading-[0.95] tracking-[-0.05em] text-white">
              {title.originalTitle && title.originalTitle !== title.title
                ? title.originalTitle
                : title.title}
            </h1>

            {title.originalTitle &&
              title.originalTitle !== title.title && (
                <p className="mt-2 break-words text-sm font-medium tracking-[-0.01em] text-white/45 sm:text-base">
                  {title.title}
                </p>
              )}

            {title.tagline && (
              <p className="mt-3 max-w-3xl break-words text-sm italic leading-relaxed text-white/55 sm:text-base">
                &ldquo;{title.tagline}&rdquo;
              </p>
            )}

            {title.genres && title.genres.length > 0 && (
              <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-white/45 sm:text-[13px]">
                {title.genres.slice(0, 4).join(" · ")}
              </p>
            )}

            {title.overview && (
              <p className="mt-5 max-w-3xl text-[15px] leading-[1.65] text-white/72 sm:mt-6 sm:text-base sm:leading-[1.7]">
                {title.overview}
              </p>
            )}

            {showProgressBlock && (
              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                <div className="inline-flex max-w-full items-center gap-3 rounded-2xl border border-cyan-300/22 bg-cyan-500/[0.08] px-3 py-2.5 backdrop-blur-md sm:gap-4 sm:px-4 sm:py-3">
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200/80">
                    {isComplete ? "Concluída" : hasProgress ? "Continuar" : "Assistindo"}
                  </span>

                  {nextEpUser && !isComplete && (
                    <span className="text-[13px] font-bold tracking-[-0.01em] text-white/92">
                      Próximo: S{pad2(nextEpUser.seasonNumber)}E
                      {pad2(nextEpUser.episodeNumber)}
                    </span>
                  )}

                  {hasProgress && !isComplete &&
                  currentSeasonNumber != null &&
                  currentSeasonWatched != null &&
                  currentSeasonTotal != null ? (
                    <span className="text-[11px] font-semibold text-white/55">
                      T{currentSeasonNumber} · {currentSeasonWatched}/{currentSeasonTotal} eps
                    </span>
                  ) : hasProgress && typeof totalEpisodes === "number" ? (
                    <span className="text-[11px] font-semibold text-white/55">
                      {watchedCount}/{totalEpisodes} eps
                    </span>
                  ) : null}

                  {progressPct !== null && (
                    <span
                      className="relative h-1 w-24 overflow-hidden rounded-full bg-white/[0.08] sm:w-32"
                      aria-hidden
                    >
                      <span
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-300/90 via-indigo-300/90 to-fuchsia-300/90"
                        style={{ width: `${progressPct}%` }}
                      />
                    </span>
                  )}
                </div>

                {isAuthenticated && (
                  <SeriesProgressChip
                    tmdbId={title.id}
                    progress={progress}
                    hasSeasons={hasSeasons}
                  />
                )}
              </div>
            )}

            <div className="mt-7 sm:mt-9">
              <TitleActions
                tmdbId={title.id}
                mediaType={title.mediaType}
                initialState={title.userState}
                initialProgress={title.userSeriesProgress ?? null}
                seasons={
                  title.seasons?.map((season) => ({
                    seasonNumber: season.seasonNumber,
                    name: season.name,
                    episodeCount: season.episodeCount,
                  })) ?? []
                }
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

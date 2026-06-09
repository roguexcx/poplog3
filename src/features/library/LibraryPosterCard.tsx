import Image from "next/image";
import Link from "next/link";

import { TmdbImageLegacy as TmdbImage } from "@/components/images/TmdbImage";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";
import type { Poplog3UserLibraryItem } from "@/server/library/library-service";

const STATUS_BADGE: Record<string, string> = {
  watching: "border-violet-300/35 bg-violet-500/20 text-violet-100",
  watchlist: "border-cyan-300/30 bg-cyan-500/18 text-cyan-100",
  watched: "border-white/[0.12] bg-white/[0.08] text-white/72",
  abandoned: "border-rose-300/30 bg-rose-500/16 text-rose-100",
  fridge: "border-amber-300/30 bg-amber-500/16 text-amber-100",
};

type LibraryPosterCardProps = {
  item: Poplog3UserLibraryItem;
  priority?: boolean;
};

export default function LibraryPosterCard({
  item,
  priority,
}: LibraryPosterCardProps) {
  const title = item.title;
  const isFavorite = item.favorite === true;
  const isWatching =
    item.media_type === "movie"
      ? item.status === "watching"
      : item.status === "watching" && item.computed_state === "in_progress";
  const progress =
    typeof item.progress_pct === "number" ? item.progress_pct : null;
  const hasProvider = !!item.best_provider_logo;

  const displayTitle =
    title?.title ??
    title?.original_title ??
    `${item.media_type}/${item.tmdb_id}`;

  const subtitle = getPosterSubtitle(item);
  const runtimeLabels = getRuntimeLabels(item);

  // Prefer imdbId for links when tmdb_id is synthetic (negative), gives cleaner URLs
  const linkId = item.imdb_id ?? item.tmdb_id;

  return (
    <Link href={`/title/${item.media_type}/${linkId}`} className="group block">
      <article className="relative">
        <div
          className={[
            "absolute -inset-2 rounded-[1.5rem] opacity-0 blur-2xl transition duration-500 group-hover:opacity-100 sm:-inset-2.5 sm:rounded-[2rem]",
            isFavorite
              ? "bg-amber-400/[0.18]"
              : "bg-gradient-to-b from-indigo-400/[0.12] to-transparent",
          ].join(" ")}
        />

        <div
          className={[
            "relative overflow-hidden rounded-[1rem] border bg-white/[0.032] shadow-[0_18px_56px_rgba(0,0,0,0.40)] sm:rounded-[1.45rem]",
            "transition duration-300 group-hover:-translate-y-2 group-hover:shadow-[0_36px_100px_rgba(0,0,0,0.62)]",
            isFavorite
              ? "border-amber-300/[0.18] group-hover:border-amber-300/[0.34] group-hover:bg-amber-900/[0.07]"
              : "border-white/[0.08] group-hover:border-white/[0.20] group-hover:bg-white/[0.06]",
          ].join(" ")}
        >
          <div className="relative aspect-[2/3] overflow-hidden bg-white/[0.04]">
            <TmdbImage
              path={title?.poster_path ?? null}
              fallbackPath={title?.backdrop_path ?? null}
              size="w500"
              alt={displayTitle}
              fallbackLabel={displayTitle}
              priority={priority}
              className="h-full w-full object-cover brightness-[0.88] saturate-[1.08] transition duration-500 group-hover:scale-[1.06] group-hover:brightness-[1.04]"
            />

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/24" />

            <div
              className={[
                "pointer-events-none absolute inset-0 opacity-0 transition duration-500 group-hover:opacity-100",
                isFavorite
                  ? "bg-[radial-gradient(circle_at_50%_110%,rgba(251,191,36,0.20),transparent_48%),radial-gradient(circle_at_15%_0%,rgba(251,191,36,0.10),transparent_40%)]"
                  : "bg-[radial-gradient(circle_at_50%_112%,rgba(34,211,238,0.22),transparent_46%),radial-gradient(circle_at_20%_0%,rgba(129,140,248,0.16),transparent_42%)]",
              ].join(" ")}
            />

            <div
              className={`absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] shadow-[0_8px_22px_rgba(0,0,0,0.38)] backdrop-blur-md sm:left-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-[9px] sm:tracking-[0.14em] ${
                STATUS_BADGE[item.status] ?? STATUS_BADGE.watched
              }`}
            >
              {formatStatus(item.status)}
            </div>

            <div className="absolute right-2 top-2 flex flex-col items-end gap-1.5 sm:right-3 sm:top-3">
              {isFavorite ? (
                <div className="rounded-full border border-amber-300/30 bg-amber-500/22 px-2 py-0.5 text-[9px] font-black text-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.30)] backdrop-blur-md sm:py-1">
                  ★
                </div>
              ) : typeof title?.vote_average === "number" ? (
                <div className="rounded-full border border-amber-200/18 bg-black/50 px-2 py-0.5 text-[9px] font-black text-amber-100 shadow-[0_8px_22px_rgba(0,0,0,0.35)] backdrop-blur-md sm:px-2.5 sm:py-1 sm:text-[10px]">
                  ★ {title.vote_average.toFixed(1)}
                </div>
              ) : null}
            </div>

            {hasProvider && resolveCatalogImage(item.best_provider_logo, "original") && (
              <div className="absolute bottom-2 right-2 overflow-hidden rounded-md border border-white/[0.14] bg-black/55 shadow-[0_4px_14px_rgba(0,0,0,0.45)] backdrop-blur-md sm:bottom-3 sm:right-3 sm:rounded-lg">
                <Image
                  src={resolveCatalogImage(item.best_provider_logo, "original")!}
                  alt={item.best_provider_name ?? "Provider"}
                  width={28}
                  height={28}
                  unoptimized
                  className="h-6 w-6 object-cover sm:h-7 sm:w-7"
                />
              </div>
            )}

            <div className="absolute inset-x-0 bottom-0 p-2.5 sm:p-4">
              <div className="translate-y-2 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                <div className="flex flex-wrap items-center gap-1.5">
                  {subtitle && (
                    <span className="rounded-full border border-white/[0.12] bg-black/50 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-white/76 backdrop-blur-md sm:px-2.5 sm:py-1 sm:text-[9px] sm:tracking-[0.14em]">
                      {subtitle}
                    </span>
                  )}

                  {runtimeLabels.map((runtime) => (
                    <span
                      key={runtime}
                      className="rounded-full border border-white/[0.12] bg-black/50 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-white/55 backdrop-blur-md sm:px-2.5 sm:py-1 sm:text-[9px] sm:tracking-[0.14em]"
                    >
                      {runtime}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {isWatching && progress !== null && progress > 0 && (
              <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/40">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-indigo-400 shadow-[0_0_8px_rgba(139,92,246,0.60)]"
                  style={{ width: `${Math.min(100, progress)}%` }}
                />
              </div>
            )}
          </div>

          <div className="flex h-7 items-center px-2 sm:px-[10px]">
            <div className="flex items-center gap-[5px] text-[11px] font-normal leading-none text-white/40">
              <span>{title?.year ?? "—"}</span>
              <span className="text-white/20">·</span>
              <span>{item.media_type === "movie" ? "Filme" : "Série"}</span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

function getPosterSubtitle(item: Poplog3UserLibraryItem) {
  const releaseTime = getReleaseTime(item);

  if (releaseTime && releaseTime > Date.now()) {
    return "Em breve";
  }

  if (
    item.media_type === "tv" &&
    item.status === "watching" &&
    item.computed_state === "in_progress"
  ) {
    return "Continuidade";
  }

  if (item.status === "watchlist") {
    return "Na lista";
  }

  return null;
}

function getRuntimeLabels(item: Poplog3UserLibraryItem) {
  if (item.media_type === "tv") {
    const labels = [item.average_episode_runtime_label ?? null, item.runtime_label ?? null].filter(
      (label): label is string => Boolean(label),
    );
    if (labels.length > 0) return labels;
    const fallback = formatDurationBadge(item.duration_sort_minutes);
    return fallback ? [fallback] : ["Duração indisponível"];
  }

  if (item.runtime_label) return [item.runtime_label];
  const fallback = formatDurationBadge(item.duration_sort_minutes ?? item.title?.runtime);
  return fallback ? [fallback] : ["Duração indisponível"];
}

function formatDurationBadge(minutes: number | null | undefined) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins}min total`;
  return mins > 0 ? `${hours}h${mins}min total` : `${hours}h total`;
}

function getReleaseTime(item: Poplog3UserLibraryItem) {
  const title = item.title;

  const date =
    item.media_type === "tv"
      ? title?.first_air_date ?? title?.release_date
      : title?.release_date ?? title?.first_air_date;

  const time = date ? new Date(date).getTime() : 0;

  return Number.isFinite(time) ? time : 0;
}

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    watchlist: "Watchlist",
    watching: "Assistindo",
    watched: "Assistido",
    abandoned: "Abandonado",
    fridge: "Geladeira",
  };

  return labels[status] ?? status;
}

import Link from "next/link";

import { TmdbImage } from "@/components/images/TmdbImage";
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
}: LibraryPosterCardProps) {
  const title = item.title;

  const displayTitle =
    title?.title ??
    title?.original_title ??
    `${item.media_type}/${item.tmdb_id}`;

  const subtitle = getPosterSubtitle(item);
  const runtime = getRuntimeLabel(item);

  return (
    <Link
      href={`/title/${item.media_type}/${item.tmdb_id}`}
      className="group block"
    >
      <article className="relative">
        <div className="absolute -inset-2 rounded-[1.7rem] bg-gradient-to-b from-white/[0.08] to-transparent opacity-0 blur-xl transition duration-500 group-hover:opacity-100" />

        <div className="relative overflow-hidden rounded-[1.45rem] border border-white/[0.08] bg-white/[0.035] shadow-[0_20px_60px_rgba(0,0,0,0.38)] transition duration-300 group-hover:-translate-y-1.5 group-hover:border-white/[0.18] group-hover:bg-white/[0.06] group-hover:shadow-[0_34px_90px_rgba(0,0,0,0.58)]">
          <div className="relative aspect-[2/3] overflow-hidden bg-white/[0.04]">
            <TmdbImage
              path={title?.poster_path ?? null}
              fallbackPath={title?.backdrop_path ?? null}
              size="w500"
              alt={displayTitle}
              fallbackLabel={displayTitle}
              className="h-full w-full object-cover brightness-[0.9] saturate-[1.08] transition duration-500 group-hover:scale-[1.055] group-hover:brightness-105"
            />

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/92 via-black/12 to-black/24" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_112%,rgba(34,211,238,0.24),transparent_46%),radial-gradient(circle_at_20%_0%,rgba(129,140,248,0.18),transparent_42%)] opacity-0 transition duration-500 group-hover:opacity-100" />

            <div className={`absolute left-3 top-3 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] shadow-[0_10px_28px_rgba(0,0,0,0.35)] backdrop-blur-md ${STATUS_BADGE[item.status] ?? STATUS_BADGE.watched}`}>
              {formatStatus(item.status)}
            </div>

            {typeof title?.vote_average === "number" && (
              <div className="absolute right-3 top-3 rounded-full border border-amber-200/20 bg-black/48 px-2.5 py-1 text-[10px] font-black text-amber-100 shadow-[0_10px_28px_rgba(0,0,0,0.35)] backdrop-blur-md">
                ★ {title.vote_average.toFixed(1)}
              </div>
            )}

            <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
              <div className="translate-y-2 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                <div className="flex flex-wrap items-center gap-2">
                  {subtitle && (
                    <span className="rounded-full border border-white/[0.12] bg-black/45 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white/76 backdrop-blur-md">
                      {subtitle}
                    </span>
                  )}

                  {runtime && (
                    <span className="rounded-full border border-white/[0.12] bg-black/45 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white/58 backdrop-blur-md">
                      {runtime}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-1 pb-1 pt-3">
          <h2 className="line-clamp-2 text-[13px] font-bold leading-[1.32] tracking-[-0.02em] text-white/92 transition group-hover:text-white">
            {displayTitle}
          </h2>

          <div className="mt-1.5 flex items-center gap-2 text-[11px] font-medium text-white/36">
            <span>{title?.year ?? "—"}</span>
            <span className="h-1 w-1 rounded-full bg-white/18" />
            <span>{item.media_type === "movie" ? "Filme" : "Série"}</span>
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

  if (item.media_type === "tv" && item.status === "watching") {
    return "Continuidade";
  }

  if (item.status === "watchlist") {
    return "Na lista";
  }

  return null;
}

function getRuntimeLabel(item: Poplog3UserLibraryItem) {
  const runtime =
    item.media_type === "tv"
      ? item.title?.episode_run_time?.find(
          (value) => typeof value === "number" && value > 0,
        ) ?? null
      : item.title?.runtime ?? null;

  if (!runtime) {
    return null;
  }

  return item.media_type === "tv" ? `${runtime} min/ep` : `${runtime} min`;
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

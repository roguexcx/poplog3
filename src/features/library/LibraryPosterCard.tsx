import Link from "next/link";

import { TmdbImage } from "@/components/images/TmdbImage";
import type { Poplog3UserLibraryItem } from "@/server/library/library-service";

type LibraryPosterCardProps = {
  item: Poplog3UserLibraryItem;
  priority?: boolean;
};

export default function LibraryPosterCard({
  item,
}: LibraryPosterCardProps) {
  const title = item.title;

  const displayTitle =
    title?.title ?? `${item.media_type}/${item.tmdb_id}`;

  const subtitle = getPosterSubtitle(item);

  return (
    <Link
      href={`/title/${item.media_type}/${item.tmdb_id}`}
      className="group block"
    >
      <article className="relative">
        <div className="relative overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-white/[0.035] shadow-[0_18px_50px_rgba(0,0,0,0.28)] transition duration-300 group-hover:-translate-y-1 group-hover:border-white/[0.16] group-hover:bg-white/[0.055] group-hover:shadow-[0_26px_70px_rgba(0,0,0,0.48)]">
          <div className="relative aspect-[2/3] overflow-hidden bg-white/[0.04]">
            <TmdbImage
              path={title?.poster_path ?? null}
              fallbackPath={title?.backdrop_path ?? null}
              size="w500"
              alt={displayTitle}
              fallbackLabel={displayTitle}
              className="h-full w-full object-cover brightness-[0.92] saturate-[1.04] transition duration-500 group-hover:scale-[1.045] group-hover:brightness-100"
            />

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/82 via-black/10 to-black/20" />

            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_115%,rgba(99,102,241,0.28),transparent_58%)] opacity-0 transition duration-500 group-hover:opacity-100" />

            <div className="absolute left-3 top-3 rounded-full border border-white/[0.12] bg-black/55 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white/78 backdrop-blur-md">
              {formatStatus(item.status)}
            </div>

            {typeof title?.vote_average === "number" && (
              <div className="absolute right-3 top-3 rounded-full border border-amber-300/20 bg-black/55 px-2.5 py-1 text-[10px] font-black text-amber-200 backdrop-blur-md">
                ★ {title.vote_average.toFixed(1)}
              </div>
            )}

            <div className="absolute inset-x-0 bottom-0 p-3 opacity-0 transition duration-300 group-hover:opacity-100 sm:p-4">
              {subtitle ? (
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/72">
                  {subtitle}
                </p>
              ) : (
                <div className="h-4" />
              )}
            </div>
          </div>
        </div>

        <div className="px-1 pb-1 pt-3">
          <h2 className="line-clamp-2 text-[13px] font-semibold leading-[1.35] tracking-[-0.015em] text-white/92">
            {displayTitle}
          </h2>

          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-white/36">
            <span>{title?.year ?? "—"}</span>

            <span className="h-1 w-1 rounded-full bg-white/18" />

            <span>
              {item.media_type === "movie" ? "Filme" : "Série"}
            </span>
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

  return null;
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
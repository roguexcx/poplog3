"use client";

import Image from "next/image";

import { useRandomizedTitleDisplay } from "@/components/titles/LocalizedTitle";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";
import CardProviderBadge from "@/components/ui/CardProviderBadge";

export type NewEpisodeItem = {
  content_id: string;
  tmdb_id: number;
  title: string;
  original_title?: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  computed_state: string | null;
  watched_episodes: number;
  aired_episodes: number;
  episodes_behind: number;
  progress_pct: number;
  next_season: number | null;
  next_episode: number | null;
  next_episode_name: string | null;
  next_episode_still_path: string | null;
  next_episode_air_date: string | null;
  last_air_date: string | null;
  days_since_new_episode: number | null;
  runtime: number | null;
  runtime_label: string | null;
  season_watched: number | null;
  season_total: number | null;
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
};

type Props = {
  item: NewEpisodeItem;
  onClick: () => void;
};

function episodeTag(
  season: number | null,
  episode: number | null
): string | null {
  if (season == null || episode == null) return null;
  return `T${season}E${episode}`;
}

// Limite em dias para exibir o badge "NOVO". Acima disso, exibe "DISPONÍVEL".
const NEW_EPISODE_BADGE_DAYS = 7;

function resolveEpisodeBadge(nextEpAirDate: string | null, daysSince: number | null): string | null {
  const refDate = nextEpAirDate ?? null;
  const days = refDate
    ? Math.max(0, Math.floor((Date.now() - new Date(refDate).getTime()) / 86_400_000))
    : daysSince;
  if (days === null) return "NOVO"; // sem data → assume novo para não suprimir
  if (days <= NEW_EPISODE_BADGE_DAYS) return "NOVO";
  return "DISPONÍVEL";
}

export default function NewEpisodeCard({ item, onClick }: Props) {
  const backdropUrl =
    resolveCatalogImage(item.next_episode_still_path, "w780") ??
    resolveCatalogImage(item.backdrop_path, "w780") ??
    resolveCatalogImage(item.poster_path, "w780");

  const posterUrl = resolveCatalogImage(item.poster_path, "w92");

  const epTag = episodeTag(item.next_season, item.next_episode);
  const { mainTitle } = useRandomizedTitleDisplay(item.title, item.original_title);
  const seasonPct =
    item.season_total != null && item.season_total > 0 && item.season_watched != null
      ? Math.min(100, Math.round((item.season_watched / item.season_total) * 100))
      : null;
  const progressPct = seasonPct ?? Math.min(100, Math.max(0, item.progress_pct));
  const newEpisodeBadge = resolveEpisodeBadge(item.next_episode_air_date, item.days_since_new_episode);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-900/80 text-left transition-all hover:border-white/[0.16] hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
    >
      {backdropUrl && (
        <div className="absolute inset-0 -z-0">
          <Image
            src={backdropUrl}
            alt=""
            fill
            unoptimized
            sizes="(max-width: 768px) 100vw, 50vw"
            className="h-full w-full object-cover object-center opacity-35 brightness-75 transition-opacity group-hover:opacity-45"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/85 via-zinc-950/50 to-zinc-950/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-transparent" />
        </div>
      )}

      <div className="relative flex min-h-[72px] items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5 sm:py-4">
        {posterUrl && (
          <div
            className="relative hidden shrink-0 overflow-hidden rounded-lg border border-white/[0.10] sm:block"
            style={{ width: 40, height: 58 }}
          >
            <Image
              src={posterUrl}
              alt=""
              fill
              unoptimized
              sizes="40px"
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {newEpisodeBadge && (
              <span
                className={[
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] shadow-sm",
                  newEpisodeBadge === "NOVO"
                    ? "bg-rose-500 text-white"
                    : "border border-white/[0.18] bg-white/[0.06] text-white/55",
                ].join(" ")}
              >
                {newEpisodeBadge}
              </span>
            )}

            {epTag && (
              <span className="rounded-full border border-white/[0.15] bg-white/[0.07] px-2 py-0.5 text-[10px] font-bold text-white/75">
                {epTag}
              </span>
            )}

            {item.best_provider_name && (
              <CardProviderBadge
                name={item.best_provider_name}
                logoPath={item.best_provider_logo}
                type={item.best_provider_type}
              />
            )}
          </div>

          <p className="truncate text-[14px] font-black leading-tight tracking-[-0.02em] text-white">
            {mainTitle}
          </p>

          {item.next_episode_name && (
            <p className="mt-0.5 truncate text-[12px] leading-tight text-white/50">
              &ldquo;{item.next_episode_name}&rdquo;
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {item.runtime_label && (
            <span className="text-[12px] font-semibold tabular-nums text-white/45">
              {item.runtime_label}
            </span>
          )}

          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.07] text-white/60 transition-all group-hover:bg-rose-500/80 group-hover:text-white"
          >
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-3 w-3 translate-x-[1px]"
            >
              <path d="M5 3.5l8 4.5-8 4.5V3.5z" />
            </svg>
          </span>
        </div>
      </div>

      <div className="relative h-[3px] w-full overflow-hidden bg-white/[0.05]">
        {progressPct > 0 && (
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-rose-400 via-pink-400 to-fuchsia-400"
            style={{ width: `${progressPct}%` }}
          />
        )}
      </div>
    </button>
  );
}

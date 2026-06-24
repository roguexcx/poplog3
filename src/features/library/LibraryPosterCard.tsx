import Image from "next/image";
import Link from "next/link";
import { Layers3 } from "lucide-react";

import { TmdbImageLegacy as TmdbImage } from "@/components/images/TmdbImage";
import {
  getCanonicalProviderDisplayName,
  resolveProviderLogoForRender,
} from "@/lib/streaming/provider-display";
import { resolveDisplayTitle } from "@/lib/titles/display-title";
import type { Poplog3UserLibraryItem } from "@/server/library/library-service";
import { getComingSoonInfo, getTheatricalStatus } from "./library-coming-soon";

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
  inCustomList?: boolean;
};

export default function LibraryPosterCard({
  item,
  priority,
  inCustomList = false,
}: LibraryPosterCardProps) {
  const title = item.title;
  const isFavorite = item.favorite === true;
  const isWatching =
    item.media_type === "movie"
      ? item.status === "watching"
      : item.status === "watching" && item.computed_state === "in_progress";
  const progress =
    typeof item.progress_pct === "number" ? item.progress_pct : null;

  // Badge de streaming: espelha a detail page (TitleProviders) — mostra o provider
  // sempre que houver dado (logo OU apenas nome). Antes o badge era gated por logo,
  // então providers sem logo (ex.: HBO MAX) sumiam no card mas apareciam no
  // detalhe. Agora: logo quando disponível, senão um chip com o nome do provider.
  const providerName = getCanonicalProviderDisplayName({ name: item.best_provider_name }) ?? item.best_provider_name ?? null;
  const providerLogoSrc = resolveProviderLogoForRender({
    name: providerName,
    logoUrl: item.best_provider_logo,
  });
  const hasProvider = !!(providerLogoSrc || providerName);

  const displayTitle = resolveDisplayTitle({
    title: title?.title,
    originalTitle: title?.original_title,
    tmdbId: item.tmdb_id,
    imdbId: item.imdb_id,
    mediaType: item.media_type,
  });

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
              {formatStatus(item)}
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

            {inCustomList && (
              <span
                className="absolute bottom-2 left-2 grid h-7 w-7 place-items-center rounded-full border border-indigo-200/25 bg-indigo-950/72 text-indigo-100 shadow-[0_8px_22px_rgba(0,0,0,0.42)] backdrop-blur-md sm:bottom-3 sm:left-3"
                title="Em uma ou mais listas personalizadas"
                aria-label="Em uma ou mais listas personalizadas"
              >
                <Layers3 className="h-3.5 w-3.5" aria-hidden />
              </span>
            )}

            {hasProvider && (
              <div className="absolute bottom-2 right-2 overflow-hidden rounded-md border border-white/[0.14] bg-black/55 shadow-[0_4px_14px_rgba(0,0,0,0.45)] backdrop-blur-md sm:bottom-3 sm:right-3 sm:rounded-lg">
                {providerLogoSrc ? (
                  <Image
                    src={providerLogoSrc}
                    alt={providerName ?? "Provider"}
                    width={28}
                    height={28}
                    unoptimized
                    className="h-6 w-6 object-cover sm:h-7 sm:w-7"
                  />
                ) : (
                  <span className="block max-w-[88px] truncate px-1.5 py-1 text-[8px] font-black uppercase tracking-[0.06em] text-white/85 sm:text-[9px]">
                    {providerName}
                  </span>
                )}
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
  const comingSoon = getComingSoonInfo(item);
  const theatrical = getTheatricalStatus(item);

  if (comingSoon.isComingSoon) {
    // "Nos cinemas" tem prioridade de rótulo sobre "Aguardando VOD" na janela theatrical.
    if (theatrical.inTheaters) return "Nos cinemas";
    if (comingSoon.phase === "awaiting_vod") {
      return comingSoon.displayDate ? "VOD previsto" : "Aguardando VOD";
    }
    if (comingSoon.phase === "critical_recheck") return "Revalidando VOD";
    return "Em breve";
  }

  // Status theatrical canônico (sinal ativo ou fallback temporal seguro).
  if (theatrical.inTheaters) {
    return "Nos cinemas";
  }

  if (item.availability_us?.state === "unavailable") {
    return "Sem disponibilidade encontrada";
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
    const labels = [
      item.remaining_runtime_label ?? null,
      item.average_episode_runtime_label ?? item.runtime_label ?? null,
    ].filter(
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

function formatStatus(item: Poplog3UserLibraryItem) {
  if (item.media_type === "tv" && item.computed_state === "up_to_date") return "Em dia";
  if (item.media_type === "tv" && item.computed_state === "completed") return "Concluída";

  const labels: Record<string, string> = {
    watchlist: "Watchlist",
    watching: "Assistindo",
    watched: "Assistido",
    abandoned: "Abandonado",
    fridge: "Geladeira",
  };

  return labels[item.status] ?? item.status;
}

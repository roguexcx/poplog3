// src/app/profile/ProfileClient.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { type User } from "@supabase/supabase-js";
import { scoreTitle, buildReason, type SeasonContext } from "@/lib/relevance-score";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import TmdbImage from "@/components/images/TmdbImage";
import { buildTmdbUrl } from "@/lib/images/url";
import {
  buildWatchPlanningMetrics,
  buildSeriesContinuationState,
  getWatchPlanningBadges,
  sortWatchPlanningItems,
  withWatchPlanning,
  formatWatchMinutes,
  type WatchPlanningMetrics,
  type WatchPlanningSort,
} from "@/lib/watch-planning";

// ─── Types ────────────────────────────────────────────────────────────────────

type TMDBDetail = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  runtime?: number;
  episode_run_time?: number[];
  overview?: string;
  popularity?: number;
  status?: string;
  genres?: { id: number; name: string }[];
  seasons?: { season_number: number; episode_count: number; name: string }[];
};

type EpisodeProgress = {
  tmdb_id: number;
  season: number;
  episode: number;
  watched_at: string;
};

type NextEpisode = {
  season: number;
  episode: number;
  seasonName?: string;
  still_path?: string | null;
  name?: string;
};

type EnrichedTitle = {
  id: number;
  tmdb_id: number;
  media_type: "movie" | "tv";
  status: "watchlist" | "watched" | "watching" | "fridge" | "abandoned" | null;
  favorite: boolean;
  fridge?: boolean | null;
  created_at: string;
  watched_at?: string | null;
  tmdb: TMDBDetail | null;
  watchedEpisodes?: number;
  totalEpisodes?: number;
  remainingEpisodes?: number;
  currentSeason?: number;
  nextEpisode?: NextEpisode | null;
  watchedInCurrentSeason?: number;
  totalInCurrentSeason?: number;
  lastEpisodeWatchedAt?: string | null;
  latestReleasedEpisodeAt?: string | null;
  isContinuationComplete?: boolean;
  watchPlan?: WatchPlanningMetrics;
};

type Tab        = "watched" | "watchlist" | "favorites" | "ongoing" | "fridge" | "abandoned";
type FilterType = "all" | "movie" | "tv";
type SortOrder  = "smart" | "popular" | "shortest" | "longest" | "newest_release" | "oldest_release" | "recent" | "az" | "rating";
type PlannedTitle = EnrichedTitle & { watchPlan: WatchPlanningMetrics };
type SelectOption<T extends string> = { value: T; label: string };
type ProfileStats = {
  totalWatchedMinutes: number;
  movieWatchedMinutes: number;
  tvWatchedMinutes: number;
  watchedTitles: number;
  watchedMoviesThisMonth: number;
  averageRating: number | null;
  averageDuration: number | null;
  favoriteCount: number;
  watchlistCount: number;
  ongoingCount: number;
  completedSeriesCount: number;
  abandonedSeriesCount: number;
  dominantType: string;
  topGenres: Array<{ name: string; count: number }>;
  habitSignals: string[];
};

type Suggestion = {
  title: EnrichedTitle;
  reason: string;
  pill: "watchlist" | "ongoing" | "fridge";
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTitle(t: Pick<TMDBDetail, "title" | "name">): string {
  return t.title ?? t.name ?? "Sem título";
}

function getOriginalTitle(t: Pick<TMDBDetail, "original_title" | "original_name">): string | null {
  return t.original_title ?? t.original_name ?? null;
}

function getReleaseYear(t: Pick<TMDBDetail, "release_date" | "first_air_date">): string {
  return t.release_date?.slice(0, 4) ?? t.first_air_date?.slice(0, 4) ?? "";
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function isInFridge(title: Pick<EnrichedTitle, "fridge" | "status">): boolean {
  return title.fridge === true || title.status === "fridge";
}

const filterOptions: SelectOption<FilterType>[] = [
  { value: "all", label: "Todos" },
  { value: "movie", label: "Filmes" },
  { value: "tv", label: "Séries" },
];

const librarySortOptions: SelectOption<SortOrder>[] = [
  { value: "smart", label: "Inteligente" },
  { value: "popular", label: "Popularidade" },
  { value: "shortest", label: "Mais curto" },
  { value: "longest", label: "Mais longo" },
  { value: "newest_release", label: "Mais novo" },
  { value: "oldest_release", label: "Mais antigo" },
  { value: "rating", label: "Melhor avaliado" },
  { value: "recent", label: "Adicionado recentemente" },
  { value: "az", label: "Título" },
];

const watchPlanSortOptions: SelectOption<WatchPlanningSort>[] = [
  { value: "best_value", label: "Inteligente" },
  { value: "finish_fastest", label: "Tempo restante" },
  { value: "fewest_episodes", label: "Episódios restantes" },
  { value: "highest_progress", label: "Maior progresso" },
  { value: "newest_episode", label: "Episódio mais recente" },
  { value: "oldest_episode", label: "Episódio mais antigo" },
  { value: "most_popular", label: "Mais popular" },
  { value: "best_rated", label: "Melhor avaliado" },
];

function getWatchPlanMode(sort: WatchPlanningSort) {
  if (sort === "fewest_episodes") return "episodes";
  if (sort === "finish_fastest") return "time";
  return "hybrid";
}

function getReleaseTime(title: EnrichedTitle): number | null {
  const date = title.tmdb?.release_date ?? title.tmdb?.first_air_date ?? null;
  if (!date) return null;
  const time = new Date(date).getTime();
  return Number.isFinite(time) ? time : null;
}

function getEstimatedDuration(title: EnrichedTitle): number | null {
  if (title.media_type === "movie") return title.tmdb?.runtime ?? null;

  const totalEpisodes = title.totalEpisodes ?? title.tmdb?.seasons?.reduce((sum, season) => {
    if (season.season_number <= 0) return sum;
    return sum + (season.episode_count ?? 0);
  }, 0) ?? null;
  const runtimes = title.tmdb?.episode_run_time?.filter((runtime) => runtime > 0) ?? [];
  const averageRuntime = runtimes.length > 0
    ? runtimes.reduce((sum, runtime) => sum + runtime, 0) / runtimes.length
    : 45;

  return totalEpisodes && totalEpisodes > 0 ? totalEpisodes * averageRuntime : null;
}

function compareNullable(a: number | null, b: number | null, direction: "asc" | "desc" = "asc") {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

function formatStatMinutes(minutes: number | null): string {
  if (!minutes || minutes <= 0) return "0min";
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours <= 0) return `${mins}min`;
  return mins > 0 ? `${hours}h${String(mins).padStart(2, "0")}` : `${hours}h`;
}

function isThisMonth(date: string | null | undefined): boolean {
  if (!date) return false;
  const value = new Date(date);
  const now = new Date();
  return value.getFullYear() === now.getFullYear() && value.getMonth() === now.getMonth();
}

function scoreLibraryTitle(title: EnrichedTitle): number {
  const popularity = title.tmdb?.popularity ?? 0;
  const rating = title.tmdb?.vote_average ?? 0;
  const duration = getEstimatedDuration(title);
  const releaseTime = getReleaseTime(title);
  const durationBoost = duration === null ? 0 : Math.max(0, 1 - Math.min(duration, 900) / 900) * 12;
  const recencyBoost = releaseTime === null ? 0 : Math.max(0, Math.min(10, (releaseTime - Date.UTC(2010, 0, 1)) / 31_536_000_000));

  return scoreTitle(title) + popularity * 0.35 + rating * 4 + durationBoost + recencyBoost;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconFridge() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="5" y1="10" x2="19" y2="10" />
      <line x1="10" y1="6" x2="10" y2="8" strokeLinecap="round" />
      <line x1="10" y1="14" x2="10" y2="18" strokeLinecap="round" />
    </svg>
  );
}

// ─── PosterCard ───────────────────────────────────────────────────────────────

function PosterCard({
  item,
  priority = false,
  showFridgeBadge = false,
}: {
  item: EnrichedTitle;
  priority?: boolean;
  showFridgeBadge?: boolean;
}) {
  const title  = item.tmdb ? getTitle(item.tmdb) : `#${item.tmdb_id}`;
  const originalTitle = item.tmdb ? getOriginalTitle(item.tmdb) : null;
  const year   = item.tmdb ? getReleaseYear(item.tmdb) : "";
  const posterPath = item.tmdb?.poster_path ?? null;
  const type   = item.media_type === "movie" ? "Filme" : "Série";
  const rating = item.tmdb?.vote_average ? item.tmdb.vote_average.toFixed(1) : null;
  const THIS_YEAR = String(new Date().getFullYear());
  const showYear  = year && year !== THIS_YEAR;

  const badge = showFridgeBadge
    ? { icon: <IconFridge />, cls: "border border-cyan-400/30 bg-cyan-400/[0.14] text-cyan-300" }
    : item.favorite
      ? { label: "★", cls: "bg-amber-400/90 text-amber-900 border-0" }
      : item.status === "watched"
        ? { label: "✓", cls: "bg-emerald-500/90 text-white border-0" }
        : item.status === "watching"
          ? { label: "▶", cls: "bg-sky-500/90 text-white border-0" }
          : null;

  return (
    <Link href={`/title/${item.media_type}/${item.tmdb_id}`} className="group block">
      <div
        className={[
          "relative overflow-hidden rounded-[14px] bg-zinc-900/60 ring-1 ring-white/[0.07]",
          "transition-[transform,box-shadow,ring-color] duration-300",
          "group-hover:-translate-y-1 group-hover:ring-white/[0.18] group-hover:shadow-[0_12px_40px_rgba(0,0,0,0.55)]",
          "before:absolute before:inset-0 before:rounded-[14px] before:p-px",
          "before:bg-gradient-to-br before:from-white/10 before:via-white/[0.03] before:to-transparent",
          "before:[mask-composite:exclude] before:[webkit-mask-composite:destination-out]",
          "before:[mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)]",
        ].join(" ")}
      >
        <TmdbImage
          path={posterPath}
          kind="poster"
          size="card"
          alt={title}
          width={342}
          height={513}
          priority={priority}
          loading={priority ? "eager" : "lazy"}
          className="aspect-[2/3] w-full object-cover brightness-[0.90] saturate-[1.05] transition duration-500 group-hover:scale-[1.04] group-hover:brightness-100"
          fallback={
            <div className="aspect-[2/3] w-full flex items-center justify-center bg-zinc-900 text-zinc-700 text-xs">
              Sem poster
            </div>
          }
        />

        {badge && (
          <span className={`absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black shadow-lg ${badge.cls}`}>
            {"icon" in badge ? badge.icon : badge.label}
          </span>
        )}

        {rating && (
          <span className="absolute bottom-2 left-2 rounded-full border border-white/[0.15] bg-black/[0.75] px-2 py-0.5 text-[10px] font-black text-amber-400 backdrop-blur-[6px]">
            ⭐ {rating}
          </span>
        )}
      </div>

      <div className="mt-2 px-0.5">
        <LocalizedTitle
          title={title}
          originalTitle={originalTitle}
          variant="poster"
          className="line-clamp-2 text-[12px] font-[500] leading-[1.35] tracking-[-0.01em] text-[#e0e0f0]"
        />
        <p className="mt-0.5 text-[10px] text-zinc-600">
          {showYear ? `${year} · ` : ""}{type}
        </p>
      </div>
    </Link>
  );
}

// ─── SuggestionCard ───────────────────────────────────────────────────────────

function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const { title, reason, pill } = suggestion;
  const name     = title.tmdb ? getTitle(title.tmdb) : `#${title.tmdb_id}`;
  const originalName = title.tmdb ? getOriginalTitle(title.tmdb) : null;
  const next     = title.nextEpisode;

  // Prioriza still do próximo episódio > backdrop > poster.
  // Cada caso usa o tamanho semântico apropriado (still:large=w300,
  // backdrop:medium=w780, poster:hero=w780).
  const stillPath    = next?.still_path ?? null;
  const backdropPath = title.tmdb?.backdrop_path ?? null;
  const posterPath   = title.tmdb?.poster_path ?? null;

  type ImagePick =
    | { kind: "still"; size: "large"; path: string }
    | { kind: "backdrop"; size: "medium"; path: string }
    | { kind: "poster"; size: "hero"; path: string }
    | null;

  const pick: ImagePick = stillPath
    ? { kind: "still", size: "large", path: stillPath }
    : backdropPath
      ? { kind: "backdrop", size: "medium", path: backdropPath }
      : posterPath
        ? { kind: "poster", size: "hero", path: posterPath }
        : null;

  const pillStyle = {
    watchlist: "border-sky-400/30 bg-sky-400/[0.12] text-sky-300",
    ongoing:   "border-emerald-400/30 bg-emerald-400/[0.12] text-emerald-300",
    fridge:    "border-cyan-400/30 bg-cyan-400/[0.12] text-cyan-300",
  }[pill];

  const pillLabel = {
    watchlist: "watchlist",
    ongoing:   "em andamento",
    fridge:    "na geladeira",
  }[pill];

  const href = next
    ? `/title/${title.media_type}/${title.tmdb_id}?tab=episodes&season=${next.season}`
    : `/title/${title.media_type}/${title.tmdb_id}`;

  return (
    <Link
      href={href}
      className={[
        "group relative min-w-0 overflow-hidden rounded-2xl",
        "border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm",
        "transition duration-300 hover:-translate-y-1 hover:border-white/[0.15]",
        "hover:shadow-[0_12px_40px_rgba(0,0,0,0.55)]",
      ].join(" ")}
    >
      <div className="relative h-[100px] w-full overflow-hidden bg-zinc-900/80">
        {pick ? (
          <TmdbImage
            path={pick.path}
            kind={pick.kind}
            size={pick.size}
            alt={name}
            fill
            sizes="180px"
            loading="lazy"
            className="object-cover brightness-[0.88] saturate-[1.05] transition duration-500 group-hover:scale-[1.04] group-hover:brightness-100"
            fallback={<div className="h-full w-full bg-zinc-900" />}
          />
        ) : (
          <div className="h-full w-full bg-zinc-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        {next && (
          <div className="absolute bottom-2 left-2 rounded-full border border-white/[0.22] bg-black/[0.78] px-2 py-0.5 text-[9px] font-black text-white backdrop-blur-[6px]">
            T{next.season}E{next.episode}
          </div>
        )}
      </div>

      <div className="p-3">
        <LocalizedTitle
          title={name}
          originalTitle={originalName}
          variant="medium"
        />
        <p className="mt-1 text-[10px] text-zinc-500 line-clamp-1 leading-relaxed">
          {reason}
        </p>
        {next?.name && (
          <p className="mt-0.5 text-[10px] text-zinc-600 line-clamp-1 italic">
            {next.name}
          </p>
        )}
        <span className={`mt-2 inline-block rounded-full border px-2 py-0.5 text-[9px] font-bold ${pillStyle}`}>
          {pillLabel}
        </span>
      </div>
    </Link>
  );
}

// ─── ProgressCard ─────────────────────────────────────────────────────────────

function ProgressCard({ item }: { item: EnrichedTitle }) {
  const name    = item.tmdb ? getTitle(item.tmdb) : `#${item.tmdb_id}`;
  const originalName = item.tmdb ? getOriginalTitle(item.tmdb) : null;
  const posterPath = item.tmdb?.poster_path ?? null;
  const next    = item.nextEpisode;
  const plan = item.watchPlan ?? buildWatchPlanningMetrics({
    id: item.id,
    tmdbId: item.tmdb_id,
    mediaType: item.media_type,
    status: item.status,
    runtime: item.tmdb?.runtime ?? null,
    episodeRunTime: item.tmdb?.episode_run_time ?? null,
    totalEpisodes: item.totalEpisodes ?? null,
    watchedEpisodes: item.watchedEpisodes ?? null,
    remainingEpisodes: item.remainingEpisodes ?? null,
    nextEpisode: item.nextEpisode ?? null,
    lastWatchedAt: item.lastEpisodeWatchedAt ?? item.watched_at ?? item.created_at,
    latestReleasedEpisodeAt: item.latestReleasedEpisodeAt ?? null,
    popularity: item.tmdb?.popularity ?? null,
    voteAverage: item.tmdb?.vote_average ?? null,
  });
  const watched = plan.watchedEpisodes ?? 0;
  const total   = plan.totalEpisodes ?? 0;
  const pct     = plan.progressPercent ?? 0;
  const remaining = plan.remainingEpisodes ?? 0;
  const remainingTime = formatWatchMinutes(plan.remainingMinutes, plan.isRuntimeEstimated);
  const badges = getWatchPlanningBadges(plan).slice(0, 4);
  const isUpToDate = !next && total > 0 && remaining === 0;

  const seasonLabel = next
    ? `T${next.season}E${next.episode}${next.name ? ` · ${next.name}` : ""}`
    : item.currentSeason
      ? `Temporada ${item.currentSeason}`
      : "Em andamento";
  const stateLabel = item.media_type === "movie"
    ? "Filme em andamento"
    : isUpToDate
      ? "Aguardando próximo episódio"
      : seasonLabel;

  const href = next
    ? `/title/${item.media_type}/${item.tmdb_id}?tab=episodes&season=${next.season}`
    : `/title/${item.media_type}/${item.tmdb_id}`;

  return (
    <div className={[
      "group relative overflow-hidden rounded-[1.65rem]",
      "border border-white/[0.08] bg-white/[0.04] p-5 backdrop-blur-sm",
      "shadow-[0_12px_40px_rgba(0,0,0,0.35)]",
      "transition duration-300 hover:-translate-y-0.5 hover:border-white/[0.14] hover:shadow-[0_18px_60px_rgba(0,0,0,0.5)]",
    ].join(" ")}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.09),transparent_42%)]" />

      <div className="relative flex gap-5">
        {/* Poster */}
        <Link
          href={`/title/${item.media_type}/${item.tmdb_id}`}
          className="relative h-32 w-[86px] shrink-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-900"
        >
          <TmdbImage
            path={posterPath}
            kind="poster"
            size="card"
            alt={name}
            fill
            sizes="86px"
            loading="lazy"
            className="object-cover transition duration-500 group-hover:scale-[1.04]"
            fallback={
              <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-700">
                Sem poster
              </div>
            }
          />
        </Link>

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/title/${item.media_type}/${item.tmdb_id}`}
                className="transition hover:text-sky-300"
              >
                <LocalizedTitle
                  title={name}
                  originalTitle={originalName}
                  variant="medium"
                />
              </Link>
              <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-sky-400">
                {stateLabel}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-white/[0.10] bg-white/[0.06] px-2.5 py-1 text-[10px] font-black text-white/60">
              {pct}%
            </span>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold text-zinc-600">
              <span>Progresso</span>
              <span>
                {item.media_type === "movie"
                  ? (remainingTime ? `${remainingTime} restantes` : "tempo indisponivel")
                  : total > 0 ? `${watched}/${total} eps` : "sem episodios validos"}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-300 shadow-[0_0_12px_rgba(56,189,248,0.4)] transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {badges.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {badges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-white/[0.08] bg-white/[0.045] px-2.5 py-1 text-[9px] font-black text-zinc-400"
                >
                  {badge}
                </span>
              ))}
            </div>
          )}

          <div className="mt-auto flex items-end justify-between gap-3 pt-4">
            {isUpToDate ? (
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-1 text-[10px] font-black text-emerald-400">
                Em dia
              </span>
            ) : (
              <span />
            )}

            <Link
              href={href}
              className={`shrink-0 rounded-full px-4 py-2 text-[11px] font-black transition ${
                next
                  ? "border border-sky-400/30 bg-sky-400/[0.12] text-sky-200 hover:bg-sky-400/[0.22] hover:text-white"
                  : "border border-white/[0.09] bg-white/[0.04] text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-300"
              }`}
            >
              {next ? "▶ Próximo" : item.media_type === "movie" ? "Ver filme" : "Ver série"}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonPoster() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[2/3] w-full rounded-[14px] bg-white/[0.05]" />
      <div className="mt-2 h-3 w-3/4 rounded bg-white/[0.04]" />
      <div className="mt-1.5 h-2.5 w-1/2 rounded bg-white/[0.03]" />
    </div>
  );
}

function SkeletonProgress() {
  return (
    <div className="animate-pulse rounded-[1.65rem] border border-white/[0.05] bg-white/[0.03] p-5">
      <div className="flex gap-5">
        <div className="h-32 w-[86px] shrink-0 rounded-2xl bg-white/[0.06]" />
        <div className="flex flex-1 flex-col gap-3">
          <div className="h-4 w-2/3 rounded bg-white/[0.06]" />
          <div className="h-3 w-1/3 rounded bg-white/[0.04]" />
          <div className="mt-auto h-1.5 w-full rounded-full bg-white/[0.05]" />
        </div>
      </div>
    </div>
  );
}

// ─── Component principal ──────────────────────────────────────────────────────

export default function ProfileClient() {
  const [user, setUser]       = useState<User | null>(null);
  const [titles, setTitles]   = useState<EnrichedTitle[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterType, setFilterType] = useState<FilterType>("all");
  const [sortOrder, setSortOrder]   = useState<SortOrder>("smart");
  const [watchPlanSort, setWatchPlanSort] = useState<WatchPlanningSort>("best_value");
  const [activeTab, setActiveTab]   = useState<Tab>("ongoing");
  const [currentPage, setCurrentPage] = useState(1);

  const searchParams = useSearchParams();

  useEffect(() => {
    const tabFromUrl  = searchParams.get("tab");
    const validTabs: Tab[] = ["ongoing", "watchlist", "watched", "favorites", "fridge", "abandoned"];
    if (tabFromUrl && validTabs.includes(tabFromUrl as Tab)) {
      setActiveTab(tabFromUrl as Tab);
      setCurrentPage(1);
    }
  }, [searchParams]);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    async function initAuth() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/login"; return; }
      setUser(user);
    }
    initAuth();
  }, []);

  // ── Dados ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    const supabase = createClient();
    let mounted = true;

    async function fetchTitles() {
      try {
        const { data: rawTitles, error } = await supabase
          .from("user_titles")
          .select("*")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false });

        if (error || !rawTitles || !mounted) return;

        const { data: episodeRows } = await supabase
          .from("episode_progress")
          .select("tmdb_id, season, episode, watched_at")
          .eq("user_id", user!.id);

        const episodes: EpisodeProgress[] = episodeRows ?? [];

        const res = await fetch("/api/user/titles", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ titles: rawTitles }),
        });

        if (!res.ok || !mounted) return;
        const json = await res.json();

        // ── Busca eps disponíveis por série em andamento ───────────────────
        type AvailableEp = {
          episode_number: number;
          name: string;
          still_path: string | null;
          air_date: string | null;
          runtime?: number | null;
          available: boolean;
        };
        type SeasonEps = { season: number; eps: AvailableEp[] };
        const seasonEpsMap = new Map<number, SeasonEps[]>();

        const watchingTitles = (json.titles ?? []).filter(
          (t: EnrichedTitle) => t.media_type === "tv" && t.status === "watching",
        );

        await Promise.all(
          watchingTitles.map(async (t: EnrichedTitle) => {
            const seasons = t.tmdb?.seasons?.filter((s) => s.season_number > 0) ?? [];
            const seasonList: SeasonEps[] = [];

            await Promise.all(
              seasons.map(async (season) => {
                try {
                  const r = await fetch(`/api/episodes?tvId=${t.tmdb_id}&season=${season.season_number}`);
                  if (!r.ok) return;
                  const data = await r.json();
                  const available: AvailableEp[] = (data.episodes ?? []).filter((ep: AvailableEp) => ep.available);
                  if (available.length > 0) seasonList.push({ season: season.season_number, eps: available });
                } catch { /* temporada ignorada */ }
              }),
            );

            seasonList.sort((a, b) => a.season - b.season);
            seasonEpsMap.set(t.tmdb_id, seasonList);
          }),
        );

        // ── Calcula progresso e nextEpisode ───────────────────────────────
        const enriched: EnrichedTitle[] = (json.titles ?? []).map((t: EnrichedTitle) => {
          if (t.media_type !== "tv" || t.status !== "watching") return t;

          const seriesEps = episodes.filter((e) => Number(e.tmdb_id) === Number(t.tmdb_id));
          const seasonList = seasonEpsMap.get(t.tmdb_id) ?? [];
          const continuation = buildSeriesContinuationState(seasonList, seriesEps);
          const nextEpisode = continuation.nextEpisode
            ? {
                season: continuation.nextEpisode.season,
                episode: continuation.nextEpisode.episode_number,
                name: continuation.nextEpisode.name ?? undefined,
                still_path: continuation.nextEpisode.still_path ?? null,
              }
            : null;

          return {
            ...t,
            watchedEpisodes: continuation.watchedEpisodes,
            totalEpisodes: continuation.totalEpisodes,
            remainingEpisodes: continuation.remainingEpisodes,
            currentSeason: continuation.currentSeason ?? undefined,
            nextEpisode,
            watchedInCurrentSeason: continuation.watchedInCurrentSeason,
            totalInCurrentSeason: continuation.totalInCurrentSeason,
            lastEpisodeWatchedAt: continuation.lastEpisodeWatchedAt,
            latestReleasedEpisodeAt: continuation.latestReleasedEpisodeAt,
            isContinuationComplete: continuation.isContinuationComplete,
          };
        });

        if (mounted) { setTitles(enriched); setLoading(false); }
      } catch {
        if (mounted) setLoading(false);
      }
    }

    fetchTitles();

    const channel = supabase
      .channel("profile-titles-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_titles"     }, () => { if (mounted) fetchTitles(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "episode_progress"}, () => { if (mounted) fetchTitles(); })
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [user?.id]);

  // ── Filtros e ordenação ───────────────────────────────────────────────────
  function applyFiltersAndSort(list: EnrichedTitle[]) {
    let filtered = list;
    if (filterType !== "all") filtered = filtered.filter((t) => t.media_type === filterType);

    if (sortOrder === "smart") {
      filtered = [...filtered].sort((a, b) => scoreLibraryTitle(b) - scoreLibraryTitle(a));
    } else if (sortOrder === "popular") {
      filtered = [...filtered].sort((a, b) => (b.tmdb?.popularity ?? 0) - (a.tmdb?.popularity ?? 0));
    } else if (sortOrder === "shortest") {
      filtered = [...filtered].sort((a, b) => compareNullable(getEstimatedDuration(a), getEstimatedDuration(b)));
    } else if (sortOrder === "longest") {
      filtered = [...filtered].sort((a, b) => compareNullable(getEstimatedDuration(a), getEstimatedDuration(b), "desc"));
    } else if (sortOrder === "newest_release") {
      filtered = [...filtered].sort((a, b) => compareNullable(getReleaseTime(a), getReleaseTime(b), "desc"));
    } else if (sortOrder === "oldest_release") {
      filtered = [...filtered].sort((a, b) => compareNullable(getReleaseTime(a), getReleaseTime(b)));
    } else if (sortOrder === "az") {
      filtered = [...filtered].sort((a, b) => (a.tmdb ? getTitle(a.tmdb) : "").localeCompare(b.tmdb ? getTitle(b.tmdb) : "", "pt-BR"));
    } else if (sortOrder === "rating") {
      filtered = [...filtered].sort((a, b) => compareNullable(a.tmdb?.vote_average ?? null, b.tmdb?.vote_average ?? null, "desc"));
    } else {
      filtered = [...filtered].sort((a, b) => compareNullable(new Date(a.created_at).getTime(), new Date(b.created_at).getTime(), "desc"));
    }
    return filtered;
  }

  // ── Listas derivadas ──────────────────────────────────────────────────────
  const watched   = useMemo(() => applyFiltersAndSort(titles.filter((t) => t.status === "watched" || t.favorite || t.isContinuationComplete)),  [titles, filterType, sortOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const watchlist = useMemo(() => applyFiltersAndSort(titles.filter((t) => t.status === "watchlist" && !isInFridge(t))), [titles, filterType, sortOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const favorites = useMemo(() => applyFiltersAndSort(titles.filter((t) => t.favorite)),                             [titles, filterType, sortOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const fridge    = useMemo(() => applyFiltersAndSort(titles.filter(isInFridge)),                                    [titles, filterType, sortOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const abandoned = useMemo(() => applyFiltersAndSort(titles.filter((t) => t.status === "abandoned")),                [titles, filterType, sortOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  const ongoing = useMemo((): PlannedTitle[] => {
    const list = titles
      .filter((t) => t.status === "watching")
      .filter((t) => !t.isContinuationComplete && t.nextEpisode !== null)
      .map((t) => withWatchPlanning(t, {
        id: t.id,
        tmdbId: t.tmdb_id,
        mediaType: t.media_type,
        status: t.status,
        title: t.tmdb ? getTitle(t.tmdb) : null,
        runtime: t.tmdb?.runtime ?? null,
        episodeRunTime: t.tmdb?.episode_run_time ?? null,
        totalEpisodes: t.totalEpisodes ?? null,
        watchedEpisodes: t.watchedEpisodes ?? null,
        remainingEpisodes: t.remainingEpisodes ?? null,
        nextEpisode: t.nextEpisode ?? null,
        lastWatchedAt: t.lastEpisodeWatchedAt ?? t.watched_at ?? t.created_at,
        latestReleasedEpisodeAt: t.latestReleasedEpisodeAt ?? null,
        popularity: t.tmdb?.popularity ?? null,
        voteAverage: t.tmdb?.vote_average ?? null,
      }));

    return sortWatchPlanningItems(list, watchPlanSort, getWatchPlanMode(watchPlanSort));
  }, [titles, watchPlanSort]);

  // ── Sugestões para hoje ───────────────────────────────────────────────────
  const suggestions = useMemo((): Suggestion[] => {
    const result: Suggestion[] = [];

    const suggOngoing   = titles.filter((t) => t.media_type === "tv" && t.status === "watching");
    const suggWatchlist = titles.filter((t) => t.status === "watchlist" && !isInFridge(t));
    const suggFridge    = titles.filter(isInFridge);

    // Slots 1–3: séries em andamento com ep disponível
    const ongoingWithNext = suggOngoing
      .filter((t) => t.nextEpisode !== null)
      .sort((a, b) => {
        const ra = (a.totalEpisodes ?? 0) - (a.watchedEpisodes ?? 0);
        const rb = (b.totalEpisodes ?? 0) - (b.watchedEpisodes ?? 0);
        if (ra !== rb) return ra - rb;
        return (b.watchedEpisodes ?? 0) - (a.watchedEpisodes ?? 0);
      });

    ongoingWithNext.slice(0, 3).forEach((t) => {
      const seasonCtx: SeasonContext | undefined =
        t.currentSeason !== undefined &&
        t.watchedInCurrentSeason !== undefined &&
        t.totalInCurrentSeason !== undefined
          ? { season: t.currentSeason, watched: t.watchedInCurrentSeason, total: t.totalInCurrentSeason }
          : undefined;
      result.push({ title: t, reason: buildReason(t, "ongoing", seasonCtx), pill: "ongoing" });
    });

    // Slots restantes: watchlist por score + slot rotativo anti-bolha
    const watchlistSlots = Math.max(0, 6 - result.length);

    if (watchlistSlots > 0) {
      const scored = suggWatchlist.map((t) => ({ title: t, score: scoreTitle(t) }));
      const sorted = [...scored].sort((a, b) => b.score - a.score);

      const today     = new Date();
      const eligible  = scored.filter(({ title: t }) => {
        if (t.media_type === "tv") return true;
        const date = t.tmdb?.release_date ?? null;
        if (!date) return false;
        return Math.floor((today.getTime() - new Date(date).getTime()) / 86_400_000) > 45;
      });

      const dayOfYear = Math.floor(
        (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000,
      );

      const forgotten = eligible.filter(({ title: t }) =>
        !sorted.slice(0, watchlistSlots - 1).some(({ title: s }) => s.tmdb_id === t.tmdb_id),
      );

      const rotatingEligible = forgotten.length > 0 ? forgotten[dayOfYear % forgotten.length] : null;

      if (watchlistSlots === 1) {
        const top = sorted[0];
        if (top) result.push({ title: top.title, reason: buildReason(top.title, "watchlist"), pill: "watchlist" });
      } else {
        const usedIds = new Set<number>();
        let ancientSlot: typeof rotatingEligible | null = null;
        if (rotatingEligible) { ancientSlot = rotatingEligible; usedIds.add(rotatingEligible.title.tmdb_id); }

        const normalSlots = ancientSlot ? watchlistSlots - 1 : watchlistSlots;
        sorted
          .filter(({ title: t }) => !usedIds.has(t.tmdb_id))
          .slice(0, normalSlots)
          .forEach(({ title: t }) => { usedIds.add(t.tmdb_id); result.push({ title: t, reason: buildReason(t, "watchlist"), pill: "watchlist" }); });

        if (ancientSlot) result.push({ title: ancientSlot.title, reason: buildReason(ancientSlot.title, "watchlist"), pill: "watchlist" });
      }
    }

    // Geladeira: só se watchlist vazia
    if (suggWatchlist.length === 0 && suggFridge.length > 0) {
      const fridgeSlots = Math.max(0, 6 - result.length);
      const dayOfYear   = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000);
      const rotated     = [...suggFridge].sort((a, b) => ((a.tmdb_id * dayOfYear) % 100) - ((b.tmdb_id * dayOfYear) % 100));
      rotated.slice(0, fridgeSlots).forEach((t) => result.push({ title: t, reason: buildReason(t, "fridge"), pill: "fridge" }));
    }

    return result.slice(0, 6);
  }, [titles]);

  // ── Backdrop do perfil ────────────────────────────────────────────────────
  // Sorteia um backdrop entre os favoritos do usuário. Usa tamanho "hero"
  // (w1280) em vez de "original" — suficiente para tela cheia e evita
  // estourar o otimizador da Vercel em produção.
  const favoriteBackdrops = useMemo(() => {
    const paths = titles
      .filter((t) => t.favorite && t.tmdb?.backdrop_path)
      .map((t) => t.tmdb!.backdrop_path!)
      .filter(Boolean);
    return Array.from(new Set(paths)).map((path) => buildTmdbUrl("backdrop", "hero", path));
  }, [titles]);

  const profileBackdrop = favoriteBackdrops[0] ?? null;
  const heroCycleSeconds = Math.max(favoriteBackdrops.length, 1) * 9;
  const heroVisiblePercent = 100 / Math.max(favoriteBackdrops.length, 1);

  const profileStats = useMemo<ProfileStats>(() => {
    const watchedBase = titles.filter((t) => t.status === "watched" || t.isContinuationComplete);
    const watchedForTime = titles.filter((t) => t.status === "watched" || t.isContinuationComplete || t.status === "watching");
    const getWatchedMinutesForTitle = (title: EnrichedTitle) => {
      return title.status === "watching"
        ? buildWatchPlanningMetrics({
            id: title.id,
            tmdbId: title.tmdb_id,
            mediaType: title.media_type,
            status: title.status,
            runtime: title.tmdb?.runtime ?? null,
            episodeRunTime: title.tmdb?.episode_run_time ?? null,
            totalEpisodes: title.totalEpisodes ?? null,
            watchedEpisodes: title.watchedEpisodes ?? null,
            remainingEpisodes: title.remainingEpisodes ?? null,
            nextEpisode: title.nextEpisode ?? null,
            lastWatchedAt: title.lastEpisodeWatchedAt ?? title.watched_at ?? title.created_at,
            latestReleasedEpisodeAt: title.latestReleasedEpisodeAt ?? null,
            popularity: title.tmdb?.popularity ?? null,
            voteAverage: title.tmdb?.vote_average ?? null,
          }).watchedMinutes
        : getEstimatedDuration(title);
    };
    const totalWatchedMinutes = Math.round(watchedForTime.reduce((sum, title) => sum + (getWatchedMinutesForTitle(title) ?? 0), 0));
    const movieWatchedMinutes = Math.round(watchedForTime
      .filter((title) => title.media_type === "movie")
      .reduce((sum, title) => sum + (getWatchedMinutesForTitle(title) ?? 0), 0));
    const tvWatchedMinutes = Math.round(watchedForTime
      .filter((title) => title.media_type === "tv")
      .reduce((sum, title) => sum + (getWatchedMinutesForTitle(title) ?? 0), 0));
    const rated = titles.map((title) => title.tmdb?.vote_average ?? null).filter((rating): rating is number => rating !== null && rating > 0);
    const durations = titles.map(getEstimatedDuration).filter((duration): duration is number => duration !== null && duration > 0);
    const genreCounts = new Map<string, number>();
    titles.forEach((title) => {
      title.tmdb?.genres?.forEach((genre) => genreCounts.set(genre.name, (genreCounts.get(genre.name) ?? 0) + 1));
    });
    const topGenres = [...genreCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, count]) => ({ name, count }));
    const movieCount = titles.filter((title) => title.media_type === "movie").length;
    const tvCount = titles.filter((title) => title.media_type === "tv").length;
    const dominantType = tvCount > movieCount ? "Séries" : movieCount > tvCount ? "Filmes" : "Filmes e séries";
    const averageDuration = durations.length
      ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
      : null;
    const averageRating = rated.length
      ? Number((rated.reduce((sum, rating) => sum + rating, 0) / rated.length).toFixed(1))
      : null;
    const habitSignals = [
      topGenres[0] ? `Seu gênero mais recorrente é ${topGenres[0].name}.` : "Ainda faltam gêneros suficientes para ler seu padrão.",
      dominantType === "Séries" ? "Você tende a acompanhar narrativas em capítulos." : dominantType === "Filmes" ? "Seu consumo puxa mais para sessões fechadas." : "Seu perfil equilibra filmes e séries.",
      averageDuration ? `Sua duração média por título é ${formatStatMinutes(averageDuration)}.` : "A duração média aparece quando houver mais títulos com runtime.",
    ];

    return {
      totalWatchedMinutes,
      movieWatchedMinutes,
      tvWatchedMinutes,
      watchedTitles: watchedBase.length,
      watchedMoviesThisMonth: watchedBase.filter((title) => title.media_type === "movie" && isThisMonth(title.watched_at)).length,
      averageRating,
      averageDuration,
      favoriteCount: titles.filter((title) => title.favorite).length,
      watchlistCount: titles.filter((title) => title.status === "watchlist" && !isInFridge(title)).length,
      ongoingCount: titles.filter((title) => title.status === "watching" && title.media_type === "tv").length,
      completedSeriesCount: watchedBase.filter((title) => title.media_type === "tv").length,
      abandonedSeriesCount: titles.filter((title) => title.status === "abandoned" && title.media_type === "tv").length,
      dominantType,
      topGenres,
      habitSignals,
    };
  }, [titles]);

  // ── Paginação ─────────────────────────────────────────────────────────────
  const tabItems: { key: Tab; label: string; count: number }[] = [
    { key: "ongoing",   label: "Em andamento", count: ongoing.length   },
    { key: "watchlist", label: "Watchlist",     count: watchlist.length },
    { key: "watched",   label: "Assistidos",    count: watched.length   },
    { key: "favorites", label: "Favoritos",     count: favorites.length },
    { key: "fridge",    label: "Geladeira",     count: fridge.length    },
    { key: "abandoned", label: "Abandonados",   count: abandoned.length },
  ];

  const activeItems =
    activeTab === "watched"   ? watched   :
    activeTab === "watchlist" ? watchlist :
    activeTab === "favorites" ? favorites :
    activeTab === "ongoing"   ? ongoing   :
    activeTab === "fridge"    ? fridge    : abandoned;

  const ITEMS_PER_PAGE = activeTab === "ongoing" ? 6 : 14;
  const totalPages     = Math.max(1, Math.ceil(activeItems.length / ITEMS_PER_PAGE));
  const paginatedItems = activeItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);

  const displayName = user?.user_metadata?.username ?? user?.email?.split("@")[0] ?? "Usuário";
  if (!loading && !user) return null;

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#020617] text-white">
      {/* Backdrop de favorito */}
      {profileBackdrop && (
        <>
          <div
            className="pointer-events-none fixed inset-0 z-0 scale-105 bg-cover bg-center opacity-[0.35] blur-[7px]"
            style={{ backgroundImage: `url(${profileBackdrop})` }}
          />
          <div className="pointer-events-none fixed inset-0 z-0 bg-gradient-to-b from-[#020617]/85 via-[#020617]/92 to-[#020617]" />
        </>
      )}

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-8 sm:px-6">

        {/* ── Cabeçalho ── */}
        <div className="relative mb-10 overflow-hidden rounded-[1.5rem] border border-white/[0.08] bg-white/[0.035] px-5 py-6 shadow-[0_18px_70px_rgba(0,0,0,0.35)] sm:px-7 sm:py-8">
          {favoriteBackdrops.length > 0 && (
            <>
              <style>{`
                @keyframes profile-hero-fade {
                  0%, 100% { opacity: 0; }
                  4% { opacity: 0.45; }
                  ${Math.max(6, heroVisiblePercent - 4)}% { opacity: 0.45; }
                  ${heroVisiblePercent}% { opacity: 0; }
                }
              `}</style>
              {favoriteBackdrops.map((backdrop, index) => (
                <div
                  key={backdrop}
                  className="absolute inset-0 bg-cover bg-center opacity-0"
                  style={{
                    backgroundImage: `url(${backdrop})`,
                    animation: favoriteBackdrops.length > 1 ? `profile-hero-fade ${heroCycleSeconds}s infinite` : undefined,
                    animationDelay: favoriteBackdrops.length > 1 ? `${index * 9}s` : undefined,
                    opacity: favoriteBackdrops.length === 1 ? 0.45 : undefined,
                  }}
                />
              ))}
              <div className="absolute inset-0 bg-gradient-to-r from-[#020617] via-[#020617]/88 to-[#020617]/55" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent" />
            </>
          )}

          <div className="relative grid gap-6 lg:grid-cols-[1fr_390px] lg:items-end">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-sky-400/[0.16] text-2xl font-black text-sky-200 ring-1 ring-sky-300/25 backdrop-blur sm:h-20 sm:w-20 sm:text-3xl">
                {displayName.charAt(0).toUpperCase()}
              </div>

              <div className="min-w-0 flex-1">
                <p className="mb-2 text-[10px] font-black uppercase tracking-[0.3em] text-sky-300">Biblioteca pessoal</p>
                <h1 className="truncate text-3xl font-black leading-tight tracking-tight sm:text-5xl">{displayName}</h1>
                <p className="mt-2 text-sm text-zinc-400">{user?.email}</p>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <a
                    href="#estatisticas"
                    className="rounded-full border border-sky-300/25 bg-sky-300/[0.12] px-4 py-2 text-xs font-black text-sky-100 transition hover:bg-sky-300/[0.20]"
                  >
                    Ver estatísticas
                  </a>
                  <Link
                    href="/settings"
                    className="rounded-full border border-white/[0.12] bg-white/[0.05] px-4 py-2 text-xs font-bold text-zinc-300 transition hover:bg-white/[0.10] hover:text-white"
                  >
                    Configurações
                  </Link>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
              {[
                { value: formatStatMinutes(profileStats.totalWatchedMinutes), label: "tempo visto", accent: "text-sky-200" },
                { value: profileStats.watchedTitles, label: "assistidos" },
                { value: profileStats.favoriteCount, label: "favoritos", accent: "text-amber-200" },
                { value: profileStats.ongoingCount, label: "em andamento", accent: "text-cyan-200" },
              ].map(({ value, label, accent }) => (
                <div key={label} className="rounded-xl border border-white/[0.08] bg-black/25 px-3 py-3 backdrop-blur">
                  <p className={`text-xl font-black ${accent ?? "text-white"}`}>{value}</p>
                  <p className="mt-1 text-[9px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Sugestões para hoje ── */}
        {!loading && suggestions.length > 0 && (
          <div className="mb-10">
            <p className="mb-4 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
              Sugestões para hoje
            </p>
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {suggestions.map((s, i) => <SuggestionCard key={i} suggestion={s} />)}
            </div>
          </div>
        )}

        {/* ── Abas ── */}
        <section className="hidden" aria-hidden="true">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">Estatísticas</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-white">Hábitos gerais</h2>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-500">
              Uma leitura compacta do seu consumo no POPLOG, usando seus títulos, favoritos, gêneros e progresso.
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { label: "Tempo geral", value: formatStatMinutes(profileStats.totalWatchedMinutes), detail: "filmes + séries" },
                { label: "Tempo em filmes", value: formatStatMinutes(profileStats.movieWatchedMinutes), detail: "sessões fechadas" },
                { label: "Tempo em séries", value: formatStatMinutes(profileStats.tvWatchedMinutes), detail: "episódios vistos" },
                { label: "Filmes no mês", value: profileStats.watchedMoviesThisMonth, detail: "marcados como vistos" },
                { label: "Nota média", value: profileStats.averageRating ? profileStats.averageRating.toFixed(1) : "N/D", detail: "base TMDB" },
                { label: "Duração média", value: profileStats.averageDuration ? formatStatMinutes(profileStats.averageDuration) : "N/D", detail: "por título" },
                { label: "Watchlist", value: profileStats.watchlistCount, detail: "na fila" },
                { label: "Favoritos", value: profileStats.favoriteCount, detail: "sinais fortes" },
                { label: "Séries ativas", value: profileStats.ongoingCount, detail: "em andamento" },
                { label: "Abandonadas", value: profileStats.abandonedSeriesCount, detail: "séries pausadas" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-600">{stat.label}</p>
                  <p className="mt-2 text-2xl font-black text-white">{stat.value}</p>
                  <p className="mt-1 text-[11px] font-semibold text-zinc-500">{stat.detail}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600">Leitura POPLOG</p>
                  <p className="mt-2 text-lg font-black text-white">{profileStats.dominantType}</p>
                </div>
                <span className="rounded-full border border-sky-300/20 bg-sky-300/[0.10] px-3 py-1 text-[10px] font-black text-sky-200">
                  Personalização
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {profileStats.topGenres.length > 0 ? profileStats.topGenres.map((genre) => (
                  <span key={genre.name} className="rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1 text-[10px] font-black text-zinc-300">
                    {genre.name} · {genre.count}
                  </span>
                )) : (
                  <span className="rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1 text-[10px] font-black text-zinc-500">
                    Gêneros insuficientes
                  </span>
                )}
              </div>

              <div className="mt-5 space-y-2">
                {profileStats.habitSignals.map((signal) => (
                  <p key={signal} className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs font-semibold leading-relaxed text-zinc-400">
                    {signal}
                  </p>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-4">
                {[
                  { label: "Finalizadas", value: profileStats.completedSeriesCount },
                  { label: "Assistidos", value: profileStats.watchedTitles },
                  { label: "Tipo", value: profileStats.dominantType },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-base font-black text-zinc-100">{item.value}</p>
                    <p className="mt-1 text-[9px] font-black uppercase tracking-[0.14em] text-zinc-600">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="no-scrollbar mb-5 flex justify-start gap-0 overflow-x-auto border-b border-white/[0.07] sm:justify-center">
          {tabItems.map((t) => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); setCurrentPage(1); }}
              className={[
                "shrink-0 -mb-px border-b-2 px-3 py-3 text-[11px] font-black uppercase tracking-[0.2em] transition sm:px-5",
                activeTab === t.key
                  ? t.key === "fridge"
                    ? "border-cyan-400 text-cyan-300"
                    : t.key === "abandoned"
                      ? "border-rose-400 text-rose-300"
                      : "border-sky-400 text-sky-300"
                  : "border-transparent text-zinc-600 hover:text-zinc-300",
              ].join(" ")}
            >
              {t.label}
              {t.count > 0 && (
                <span className={[
                  "ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                  activeTab === t.key && t.key === "fridge"
                    ? "bg-cyan-400/20 text-cyan-400"
                    : activeTab === t.key && t.key === "abandoned"
                      ? "bg-rose-400/20 text-rose-300"
                    : activeTab === t.key
                      ? "bg-sky-400/20 text-sky-400"
                      : "bg-white/[0.07] text-zinc-500",
                ].join(" ")}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Filtros e ordenação ── */}
        <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
          {activeTab !== "ongoing" && (
            <label className="flex min-w-0 items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">Tipo</span>
              <select
                value={filterType}
                onChange={(e) => { setFilterType(e.target.value as FilterType); setCurrentPage(1); }}
                className="h-9 rounded-full border border-white/[0.12] bg-[#07111f] px-3 text-[11px] font-bold text-zinc-200 outline-none transition hover:border-white/25 focus:border-sky-300/60 sm:min-w-32"
              >
                {filterOptions.map((option) => (
                  <option key={option.value} value={option.value} className="bg-zinc-950 text-zinc-100">
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex min-w-0 items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">Ordenar</span>
            <select
              value={activeTab === "ongoing" ? watchPlanSort : sortOrder}
              onChange={(e) => {
                if (activeTab === "ongoing") setWatchPlanSort(e.target.value as WatchPlanningSort);
                else setSortOrder(e.target.value as SortOrder);
                setCurrentPage(1);
              }}
              className="h-9 rounded-full border border-white/[0.12] bg-[#07111f] px-3 text-[11px] font-bold text-zinc-200 outline-none transition hover:border-white/25 focus:border-sky-300/60 sm:min-w-52"
            >
              {(activeTab === "ongoing" ? watchPlanSortOptions : librarySortOptions).map((option) => (
                <option key={option.value} value={option.value} className="bg-zinc-950 text-zinc-100">
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mb-6 flex flex-col items-center gap-3 sm:grid sm:grid-cols-3 sm:items-center sm:gap-0">
          <div className="hidden sm:block" />

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                aria-label="Página anterior"
                className="rounded-full border border-white/[0.12] px-3 py-2 text-[11px] font-bold text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-25 sm:px-4"
              >
                ← Anterior
              </button>
              <span className="shrink-0 text-[11px] font-bold text-zinc-600">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                aria-label="Próxima página"
                className="rounded-full border border-white/[0.12] px-3 py-2 text-[11px] font-bold text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-25 sm:px-4"
              >
                Próxima →
              </button>
            </div>
          ) : (
            <div className="hidden sm:block" />
          )}

          <div className="hidden sm:block" />
        </div>

        {/* ── Conteúdo da aba ── */}
        {loading ? (
          activeTab === "ongoing" ? (
            <div className="grid gap-5 lg:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonProgress key={i} />)}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
              {Array.from({ length: 14 }).map((_, i) => <SkeletonPoster key={i} />)}
            </div>
          )
        ) : activeItems.length === 0 ? (
          <div className="py-24 text-center">
            {activeTab === "fridge" ? (
              <>
                <p className="text-sm text-zinc-500">Sua geladeira está vazia.</p>
                <p className="mt-1 text-xs text-zinc-700">Coloque séries e filmes aqui quando quiser guardar pra depois.</p>
              </>
            ) : activeTab === "ongoing" ? (
              <>
                <p className="text-sm text-zinc-500">Nenhum título em andamento.</p>
                <Link href="/" className="mt-4 inline-block text-xs font-bold text-sky-400 hover:text-sky-300">
                  Explorar títulos →
                </Link>
              </>
            ) : (
              <>
                <p className="text-sm text-zinc-500">Nada aqui ainda.</p>
                <Link href="/" className="mt-4 inline-block text-xs font-bold text-sky-400 hover:text-sky-300">
                  Explorar títulos →
                </Link>
              </>
            )}
          </div>
        ) : activeTab === "ongoing" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {paginatedItems.map((item) => <ProgressCard key={item.id} item={item} />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {paginatedItems.map((item, index) => (
              <PosterCard
                key={item.id}
                item={item}
                priority={index === 0}
                showFridgeBadge={activeTab === "fridge"}
              />
            ))}
          </div>
        )}

        <section id="estatisticas" className="mt-12 scroll-mt-6 border-t border-white/[0.07] pt-10">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">Estatísticas</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-white">Hábitos gerais</h2>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-500">
              Uma leitura compacta do seu consumo no POPLOG, usando seus títulos, favoritos, gêneros e progresso.
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { label: "Tempo geral", value: formatStatMinutes(profileStats.totalWatchedMinutes), detail: "filmes + séries" },
                { label: "Tempo em filmes", value: formatStatMinutes(profileStats.movieWatchedMinutes), detail: "sessões fechadas" },
                { label: "Tempo em séries", value: formatStatMinutes(profileStats.tvWatchedMinutes), detail: "episódios vistos" },
                { label: "Filmes no mês", value: profileStats.watchedMoviesThisMonth, detail: "marcados como vistos" },
                { label: "Nota média", value: profileStats.averageRating ? profileStats.averageRating.toFixed(1) : "N/D", detail: "base TMDB" },
                { label: "Duração média", value: profileStats.averageDuration ? formatStatMinutes(profileStats.averageDuration) : "N/D", detail: "por título" },
                { label: "Watchlist", value: profileStats.watchlistCount, detail: "na fila" },
                { label: "Favoritos", value: profileStats.favoriteCount, detail: "sinais fortes" },
                { label: "Séries ativas", value: profileStats.ongoingCount, detail: "em andamento" },
                { label: "Abandonadas", value: profileStats.abandonedSeriesCount, detail: "séries pausadas" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-zinc-600">{stat.label}</p>
                  <p className="mt-2 text-2xl font-black text-white">{stat.value}</p>
                  <p className="mt-1 text-[11px] font-semibold text-zinc-500">{stat.detail}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-zinc-600">Leitura POPLOG</p>
                  <p className="mt-2 text-lg font-black text-white">{profileStats.dominantType}</p>
                </div>
                <span className="rounded-full border border-sky-300/20 bg-sky-300/[0.10] px-3 py-1 text-[10px] font-black text-sky-200">
                  Personalização
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {profileStats.topGenres.length > 0 ? profileStats.topGenres.map((genre) => (
                  <span key={genre.name} className="rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1 text-[10px] font-black text-zinc-300">
                    {genre.name} · {genre.count}
                  </span>
                )) : (
                  <span className="rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1 text-[10px] font-black text-zinc-500">
                    Gêneros insuficientes
                  </span>
                )}
              </div>

              <div className="mt-5 space-y-2">
                {profileStats.habitSignals.map((signal) => (
                  <p key={signal} className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs font-semibold leading-relaxed text-zinc-400">
                    {signal}
                  </p>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-4">
                {[
                  { label: "Finalizadas", value: profileStats.completedSeriesCount },
                  { label: "Assistidos", value: profileStats.watchedTitles },
                  { label: "Tipo", value: profileStats.dominantType },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-base font-black text-zinc-100">{item.value}</p>
                    <p className="mt-1 text-[9px] font-black uppercase tracking-[0.14em] text-zinc-600">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}

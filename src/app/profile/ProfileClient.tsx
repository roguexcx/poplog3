// src/app/profile/ProfileClient.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { type User } from "@supabase/supabase-js";
import { scoreTitle, buildReason, type SeasonContext } from "@/lib/relevance-score";

// ─── Types ────────────────────────────────────────────────────────────────────

type TMDBDetail = {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  runtime?: number;
  overview?: string;
  popularity?: number;
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
  status: "watchlist" | "watched" | "watching" | null;
  favorite: boolean;
  fridge: boolean;
  created_at: string;
  watched_at?: string | null;
  tmdb: TMDBDetail | null;
  watchedEpisodes?: number;
  totalEpisodes?: number;
  currentSeason?: number;
  nextEpisode?: NextEpisode | null;
  watchedInCurrentSeason?: number;
  totalInCurrentSeason?: number;
};

type Tab        = "watched" | "watchlist" | "favorites" | "ongoing" | "fridge";
type FilterType = "all" | "movie" | "tv";
type SortOrder  = "recent" | "az" | "rating";

type Suggestion = {
  title: EnrichedTitle;
  reason: string;
  pill: "watchlist" | "ongoing" | "fridge";
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTitle(t: Pick<TMDBDetail, "title" | "name">): string {
  return t.title ?? t.name ?? "Sem título";
}

function getReleaseYear(t: Pick<TMDBDetail, "release_date" | "first_air_date">): string {
  return t.release_date?.slice(0, 4) ?? t.first_air_date?.slice(0, 4) ?? "";
}

function getPosterUrl(path?: string | null) {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : null;
}

function getBackdropUrl(path?: string | null) {
  return path ? `https://image.tmdb.org/t/p/w780${path}` : null;
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
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
  const year   = item.tmdb ? getReleaseYear(item.tmdb) : "";
  const poster = getPosterUrl(item.tmdb?.poster_path);
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
        {poster ? (
          <Image
            src={poster}
            alt={title}
            width={342}
            height={513}
            priority={priority}
            loading={priority ? "eager" : "lazy"}
            className="aspect-[2/3] w-full object-cover brightness-[0.90] saturate-[1.05] transition duration-500 group-hover:scale-[1.04] group-hover:brightness-100"
          />
        ) : (
          <div className="aspect-[2/3] w-full flex items-center justify-center bg-zinc-900 text-zinc-700 text-xs">
            Sem poster
          </div>
        )}

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
        <p className="line-clamp-2 text-[12px] font-[500] leading-[1.35] tracking-[-0.01em] text-[#e0e0f0]" title={title}>
          {title}
        </p>
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
  const backdrop = getBackdropUrl(title.tmdb?.backdrop_path);
  const poster   = getPosterUrl(title.tmdb?.poster_path);
  const next     = title.nextEpisode;
  const stillUrl = next?.still_path ? `https://image.tmdb.org/t/p/w300${next.still_path}` : null;
  const image    = stillUrl ?? backdrop ?? poster;

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
        "group relative flex-shrink-0 w-[180px] overflow-hidden rounded-2xl",
        "border border-white/[0.08] bg-white/[0.04] backdrop-blur-sm",
        "transition duration-300 hover:-translate-y-1 hover:border-white/[0.15]",
        "hover:shadow-[0_12px_40px_rgba(0,0,0,0.55)]",
      ].join(" ")}
    >
      <div className="relative h-[100px] w-full overflow-hidden bg-zinc-900/80">
        {image ? (
          <Image
            src={image}
            alt={name}
            fill
            sizes="180px"
            loading="lazy"
            className="object-cover brightness-[0.88] saturate-[1.05] transition duration-500 group-hover:scale-[1.04] group-hover:brightness-100"
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
        <p className="text-[12px] font-black text-[#e8e8f0] line-clamp-1 leading-tight tracking-[-0.01em]">
          {name}
        </p>
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
  const poster  = getPosterUrl(item.tmdb?.poster_path);
  const next    = item.nextEpisode;
  const watched = item.watchedEpisodes ?? 0;
  const total   = item.totalEpisodes ?? 0;
  const pct     = total > 0 ? Math.min(100, Math.round((watched / total) * 100)) : 0;
  const remaining  = Math.max(0, total - watched);
  const isUpToDate = !next && total > 0 && watched >= total;

  const seasonLabel = next
    ? `T${next.season}E${next.episode}${next.name ? ` · ${next.name}` : ""}`
    : item.currentSeason
      ? `Temporada ${item.currentSeason}`
      : "Em andamento";

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
          {poster ? (
            <Image
              src={poster}
              alt={name}
              fill
              sizes="86px"
              loading="lazy"
              className="object-cover transition duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-700">
              Sem poster
            </div>
          )}
        </Link>

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/title/${item.media_type}/${item.tmdb_id}`}
                className="line-clamp-2 text-[15px] font-black leading-tight tracking-tight text-white transition hover:text-sky-300"
              >
                {name}
              </Link>
              <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-sky-400">
                {isUpToDate ? "Aguardando próximo episódio" : seasonLabel}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-white/[0.10] bg-white/[0.06] px-2.5 py-1 text-[10px] font-black text-white/60">
              {pct}%
            </span>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold text-zinc-600">
              <span>Progresso</span>
              <span>{watched}/{total || "?"} eps</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-300 shadow-[0_0_12px_rgba(56,189,248,0.4)] transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="mt-auto flex items-end justify-between gap-3 pt-4">
            {remaining > 0 ? (
              <span className="rounded-full border border-white/[0.09] bg-white/[0.04] px-3 py-1 text-[10px] font-black text-zinc-400">
                Faltam {remaining} ep{remaining > 1 ? "s" : ""}
              </span>
            ) : isUpToDate ? (
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
              {next ? "▶ Próximo" : "Ver série"}
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
  const [sortOrder, setSortOrder]   = useState<SortOrder>("rating");
  const [activeTab, setActiveTab]   = useState<Tab>("ongoing");
  const [currentPage, setCurrentPage] = useState(1);

  const searchParams = useSearchParams();

  useEffect(() => {
    const tabFromUrl  = searchParams.get("tab");
    const validTabs: Tab[] = ["ongoing", "watchlist", "watched", "favorites", "fridge"];
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

          const seriesEps  = episodes.filter((e) => e.tmdb_id === t.tmdb_id);
          const seasonList = seasonEpsMap.get(t.tmdb_id) ?? [];

          const totalEpisodes = seasonList.reduce((acc, s) => acc + s.eps.length, 0);
          const watchedEpisodes = seriesEps.filter((se) =>
            seasonList.some(
              (sl) => sl.season === se.season && sl.eps.some((ae) => ae.episode_number === se.episode),
            ),
          ).length;

          let nextEpisode: NextEpisode | null = null;
          for (const { season, eps } of seasonList) {
            const watchedInSeason = new Set(
              seriesEps.filter((e) => e.season === season).map((e) => e.episode),
            );
            const nextEp = eps.find((ep) => !watchedInSeason.has(ep.episode_number));
            if (nextEp) {
              nextEpisode = { season, episode: nextEp.episode_number, name: nextEp.name ?? undefined, still_path: nextEp.still_path ?? null };
              break;
            }
          }

          const currentSeason =
            nextEpisode?.season ??
            (seriesEps.length > 0 ? Math.max(...seriesEps.map((e) => e.season)) : 1);

          const currentSeasonData      = seasonList.find((sl) => sl.season === currentSeason);
          const totalInCurrentSeason   = currentSeasonData?.eps.length ?? 0;
          const watchedInCurrentSeason = currentSeasonData
            ? seriesEps.filter((se) =>
                se.season === currentSeason &&
                currentSeasonData.eps.some((ae) => ae.episode_number === se.episode),
              ).length
            : 0;

          return { ...t, watchedEpisodes, totalEpisodes, currentSeason, nextEpisode, watchedInCurrentSeason, totalInCurrentSeason };
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
    if (sortOrder === "az") {
      filtered = [...filtered].sort((a, b) => {
        const ta = a.tmdb ? getTitle(a.tmdb) : "";
        const tb = b.tmdb ? getTitle(b.tmdb) : "";
        return ta.localeCompare(tb, "pt-BR");
      });
    } else if (sortOrder === "rating") {
      filtered = [...filtered].sort((a, b) => (b.tmdb?.vote_average ?? 0) - (a.tmdb?.vote_average ?? 0));
    }
    return filtered;
  }

  // ── Listas derivadas ──────────────────────────────────────────────────────
  const watched   = useMemo(() => applyFiltersAndSort(titles.filter((t) => t.status === "watched" || t.favorite)),  [titles, filterType, sortOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const watchlist = useMemo(() => applyFiltersAndSort(titles.filter((t) => t.status === "watchlist" && !t.fridge)), [titles, filterType, sortOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const favorites = useMemo(() => applyFiltersAndSort(titles.filter((t) => t.favorite)),                             [titles, filterType, sortOrder]); // eslint-disable-line react-hooks/exhaustive-deps
  const fridge    = useMemo(() => applyFiltersAndSort(titles.filter((t) => t.fridge === true)),                      [titles, filterType, sortOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  const ongoing = useMemo(() => {
    const list = titles.filter((t) => t.media_type === "tv" && t.status === "watching");
    const withNext  = list.filter((t) => t.nextEpisode !== null);
    const upToDate  = list.filter((t) => t.nextEpisode === null);
    withNext.sort((a, b) => {
      const ra = (a.totalEpisodes ?? 0) - (a.watchedEpisodes ?? 0);
      const rb = (b.totalEpisodes ?? 0) - (b.watchedEpisodes ?? 0);
      return ra - rb;
    });
    upToDate.sort((a, b) => {
      const ra = (a.totalEpisodes ?? 0) - (a.watchedEpisodes ?? 0);
      const rb = (b.totalEpisodes ?? 0) - (b.watchedEpisodes ?? 0);
      return ra - rb;
    });
    return [...withNext, ...upToDate];
  }, [titles]);

  // ── Sugestões para hoje ───────────────────────────────────────────────────
  const suggestions = useMemo((): Suggestion[] => {
    const result: Suggestion[] = [];

    const suggOngoing   = titles.filter((t) => t.media_type === "tv" && t.status === "watching");
    const suggWatchlist = titles.filter((t) => t.status === "watchlist" && !t.fridge);
    const suggFridge    = titles.filter((t) => t.fridge === true);

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
  const profileBackdrop = useMemo(() => {
    const backdrops = titles
      .filter((t) => t.favorite && t.tmdb?.backdrop_path)
      .map((t) => t.tmdb!.backdrop_path!)
      .filter(Boolean);
    if (!backdrops.length) return null;
    return `https://image.tmdb.org/t/p/original${backdrops[Math.floor(Math.random() * backdrops.length)]}`;
  }, [titles]);

  // ── Paginação ─────────────────────────────────────────────────────────────
  const tabItems: { key: Tab; label: string; count: number }[] = [
    { key: "ongoing",   label: "Em andamento", count: ongoing.length   },
    { key: "watchlist", label: "Watchlist",     count: watchlist.length },
    { key: "watched",   label: "Assistidos",    count: watched.length   },
    { key: "favorites", label: "Favoritos",     count: favorites.length },
    { key: "fridge",    label: "Geladeira",     count: fridge.length    },
  ];

  const activeItems =
    activeTab === "watched"   ? watched   :
    activeTab === "watchlist" ? watchlist :
    activeTab === "favorites" ? favorites :
    activeTab === "ongoing"   ? ongoing   : fridge;

  const ITEMS_PER_PAGE = activeTab === "ongoing" ? 10 : 14;
  const totalPages     = Math.max(1, Math.ceil(activeItems.length / ITEMS_PER_PAGE));
  const paginatedItems = activeItems.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);
  useEffect(() => { if (activeTab === "ongoing" && filterType !== "all") setFilterType("all"); }, [activeTab, filterType]);

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
        <div className="mb-10 flex flex-col gap-5 border-b border-white/[0.07] pb-10 sm:flex-row sm:items-center sm:gap-8">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-sky-400/[0.14] text-2xl font-black text-sky-300 ring-1 ring-sky-400/20">
            {displayName.charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-black tracking-tight">{displayName}</h1>
            <p className="mt-0.5 text-sm text-zinc-500">{user?.email}</p>
          </div>

          <div className="flex flex-wrap items-center gap-6 sm:gap-8">
            {[
              { value: watched.length,   label: "assistidos" },
              { value: watchlist.length, label: "watchlist"  },
              { value: favorites.length, label: "favoritos"  },
              ...(ongoing.length > 0 ? [{ value: ongoing.length, label: "em andamento", accent: "text-sky-300" }] : []),
              ...(fridge.length > 0  ? [{ value: fridge.length,  label: "geladeira",    accent: "text-cyan-300" }] : []),
            ].map(({ value, label, accent }) => (
              <div key={label} className="text-center">
                <p className={`text-xl font-black ${accent ?? ""}`}>{value}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-[0.15em] text-zinc-600">{label}</p>
              </div>
            ))}
            <Link
              href="/settings"
              className="shrink-0 rounded-full border border-white/[0.12] bg-white/[0.04] px-4 py-2 text-xs font-bold text-zinc-400 transition hover:bg-white/[0.08] hover:text-zinc-200"
            >
              ⚙ Configurações
            </Link>
          </div>
        </div>

        {/* ── Sugestões para hoje ── */}
        {!loading && suggestions.length > 0 && (
          <div className="mb-10">
            <p className="mb-4 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
              Sugestões para hoje
            </p>
            <div
              className="flex gap-3 overflow-x-auto pb-3"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
            >
              {suggestions.map((s, i) => <SuggestionCard key={i} suggestion={s} />)}
              {/* Padding final para não cortar o último card */}
              <div className="shrink-0 w-1" />
            </div>
          </div>
        )}

        {/* ── Filtro de tipo ── */}
        <div className="mb-4 flex items-center gap-2">
          {(["all", "movie", "tv"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => { setFilterType(f); setCurrentPage(1); }}
              disabled={activeTab === "ongoing" && f !== "all"}
              className={[
                "rounded-full border px-4 py-1.5 text-[11px] font-bold tracking-wide transition",
                filterType === f
                  ? "border-white bg-white text-black"
                  : "border-white/[0.12] text-zinc-500 hover:border-white/25 hover:text-zinc-200",
                "disabled:pointer-events-none disabled:opacity-25",
              ].join(" ")}
            >
              {{ all: "Todos", movie: "Filmes", tv: "Séries" }[f]}
            </button>
          ))}
        </div>

        {/* ── Abas ── */}
        <div
          className="mb-5 flex gap-0 overflow-x-auto border-b border-white/[0.07]"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
        >
          {tabItems.map((t) => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); setCurrentPage(1); }}
              className={[
                "shrink-0 -mb-px border-b-2 px-3 py-3 text-[10px] font-black uppercase tracking-[0.15em] transition sm:px-5 sm:tracking-[0.2em]",
                activeTab === t.key
                  ? t.key === "fridge"
                    ? "border-cyan-400 text-cyan-300"
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

        {/* ── Controles de ordenação e paginação ──
            Mobile: empilha (paginação centralizada em cima, sort embaixo).
            Desktop (sm+): grid 3 colunas (vazio · paginação · sort) como antes. */}
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

          <div className="flex justify-center sm:justify-end">
            {activeTab !== "ongoing" && (
              <select
                value={sortOrder}
                onChange={(e) => { setSortOrder(e.target.value as SortOrder); setCurrentPage(1); }}
                className="rounded-full border border-white/[0.12] bg-transparent px-4 py-2 text-[11px] font-bold text-zinc-400 outline-none transition hover:border-white/20 hover:text-zinc-200"
              >
                <option value="rating">Avaliação</option>
                <option value="recent">Recentes</option>
                <option value="az">Título</option>
              </select>
            )}
          </div>
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
                <p className="text-sm text-zinc-500">Nenhuma série em andamento.</p>
                <Link href="/" className="mt-4 inline-block text-xs font-bold text-sky-400 hover:text-sky-300">
                  Explorar séries →
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


      </div>
    </main>
  );
}

// src/features/home/ContinueWatchingSection.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { useUserData } from "@/context/UserDataContext";
import LocalizedTitle from "@/components/titles/LocalizedTitle";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type AvailableEp = {
  episode_number: number;
  name?: string;
  still_path?: string | null;
  available: boolean;
};

type SeasonListItem = {
  season: number;
  eps: AvailableEp[];
};

type TMDBDetail = {
  id: number;
  name?: string;
  original_name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  seasons?: { season_number: number; episode_count: number; name: string }[];
};

type EpisodeProgress = {
  tmdb_id: number;
  season: number;
  episode: number;
};

type NextEpisode = {
  season: number;
  episode: number;
  name?: string;
  still_path?: string | null;
};

type WatchingTitle = {
  id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  status: "watchlist" | "watched" | "watching" | "fridge" | null;
  tmdb: TMDBDetail | null;
  watchedEpisodes?: number;
  totalEpisodes?: number;
  nextEpisode?: NextEpisode | null;
  seasonList?: SeasonListItem[];
  watchedEpisodeKeys?: string[];
};

// ─── Utilitários ──────────────────────────────────────────────────────────────

function getImageUrl(path?: string | null, size = "w780"): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function getContextLabel(
  watchedSeasonEpisodes: number,
  seasonTotalEpisodes: number,
  seasonNumber: number,
): string {
  const remaining = Math.max(seasonTotalEpisodes - watchedSeasonEpisodes, 0);
  const progress = seasonTotalEpisodes > 0 ? watchedSeasonEpisodes / seasonTotalEpisodes : 0;

  if (remaining === 1) return `Último ep da T${seasonNumber}`;
  if (remaining <= 3) return `Faltam ${remaining} eps da T${seasonNumber}`;
  if (progress <= 0.25) return `Iniciando T${seasonNumber}`;
  if (progress <= 0.7) return `No meio da T${seasonNumber}`;
  return `Reta final da T${seasonNumber}`;
}

function scoreItem(item: WatchingTitle, today: string): number {
  const watched = item.watchedEpisodes ?? 0;
  const total = item.totalEpisodes ?? 0;
  const remaining = Math.max(total - watched, 0);
  const progress = total > 0 ? watched / total : 0;

  let score = progress * 40;

  if (remaining <= 3) score += 25;
  else if (remaining <= 6) score += 18;
  else if (remaining <= 10) score += 10;

  if (watched === 0) score -= 20;

  const seed = `${today}-${item.tmdb_id}`;
  score += seed.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 10;

  return score;
}

// ─── Loader de dados ──────────────────────────────────────────────────────────

async function enrichWatching(
  rawTitles: { id: string; tmdb_id: number; media_type: string; status: string | null }[],
  userId: string,
): Promise<WatchingTitle[]> {
  if (!rawTitles.length) return [];

  const supabase = createClient();

  const { data: episodeRows, error: episodesError } = await supabase
    .from("episode_progress")
    .select("tmdb_id, season, episode")
    .eq("user_id", userId);

  if (episodesError) {
    console.error("Erro ao carregar progresso de episódios:", episodesError);
    return [];
  }

  const episodes: EpisodeProgress[] = episodeRows ?? [];

  const res = await fetch("/api/user/titles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titles: rawTitles }),
  });

  if (!res.ok) return [];

  const { titles: watchingTitles }: { titles: WatchingTitle[] } = await res.json();

  const enriched = await Promise.all(
    watchingTitles.map(async (title) => {
      const validSeasons =
        title.tmdb?.seasons?.filter((s) => s.season_number > 0) ?? [];

      const seasonList: SeasonListItem[] = (
        await Promise.all(
          validSeasons.map(async (season) => {
            try {
              const r = await fetch(
                `/api/episodes?tvId=${title.tmdb_id}&season=${season.season_number}`,
              );
              if (!r.ok) return null;
              const data = await r.json();
              const available: AvailableEp[] = (data.episodes ?? []).filter(
                (ep: AvailableEp) => ep.available,
              );
              return available.length > 0
                ? { season: season.season_number, eps: available }
                : null;
            } catch {
              return null;
            }
          }),
        )
      )
        .filter((s): s is SeasonListItem => s !== null)
        .sort((a, b) => a.season - b.season);

      const watchedFromSeries = episodes.filter((ep) => ep.tmdb_id === title.tmdb_id);
      const watchedEpisodeKeys = watchedFromSeries.map(
        (ep) => `${ep.season}-${ep.episode}`,
      );

      const totalEpisodes = seasonList.reduce((acc, s) => acc + s.eps.length, 0);

      const watchedEpisodes = watchedFromSeries.filter((w) =>
        seasonList.some(
          (s) =>
            s.season === w.season &&
            s.eps.some((ep) => ep.episode_number === w.episode),
        ),
      ).length;

      let nextEpisode: NextEpisode | null = null;

      for (const season of seasonList) {
        const watchedSet = new Set(
          watchedFromSeries
            .filter((ep) => ep.season === season.season)
            .map((ep) => ep.episode),
        );
        const next = season.eps.find((ep) => !watchedSet.has(ep.episode_number));
        if (next) {
          nextEpisode = {
            season: season.season,
            episode: next.episode_number,
            name: next.name,
            still_path: next.still_path,
          };
          break;
        }
      }

      return { ...title, watchedEpisodes, totalEpisodes, nextEpisode, seasonList, watchedEpisodeKeys };
    }),
  );

  const today = new Date().toISOString().slice(0, 10);

  return enriched
    .filter((item) => item.nextEpisode)
    .map((item) => ({ item, score: scoreItem(item, today) }))
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item)
    .slice(0, 5);
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="h-[230px] w-[285px] shrink-0 animate-pulse rounded-[1.6rem] bg-white/5" />
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function WatchingCard({ item }: { item: WatchingTitle }) {
  const title = item.tmdb?.name ?? `Série #${item.tmdb_id}`;
  const originalTitle = item.tmdb?.original_name ?? null;
  const next = item.nextEpisode!;
  const watched = item.watchedEpisodes ?? 0;
  const total = item.totalEpisodes ?? 0;
  const progress = total > 0 ? Math.min(100, Math.round((watched / total) * 100)) : 0;

  const currentSeason = next.season;
  const currentSeasonData = item.seasonList?.find((s) => s.season === currentSeason);
  const watchedSeasonEpisodes =
    currentSeasonData?.eps.filter((ep) =>
      item.watchedEpisodeKeys?.includes(`${currentSeason}-${ep.episode_number}`),
    ).length ?? 0;
  const seasonTotalEpisodes = currentSeasonData?.eps.length ?? 0;
  const contextLabel = getContextLabel(watchedSeasonEpisodes, seasonTotalEpisodes, currentSeason);

  const image =
    getImageUrl(next.still_path, "w780") ??
    getImageUrl(item.tmdb?.backdrop_path, "w780") ??
    getImageUrl(item.tmdb?.poster_path, "w500");

  return (
    <Link
      href={`/title/tv/${item.tmdb_id}?tab=episodes&season=${next.season}`}
      className="group relative h-[230px] w-[285px] shrink-0 overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.04] shadow-[0_18px_60px_rgba(0,0,0,0.38)] transition duration-300 hover:-translate-y-1 hover:border-sky-300/45 hover:shadow-[0_22px_80px_rgba(56,189,248,0.16)]"
    >
      {image && (
        <Image
          src={image}
          alt={title}
          fill
          sizes="285px"
          className="object-cover transition duration-700 group-hover:scale-110"
        />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-black/78 via-45% to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-transparent to-black/25" />
      <div className="absolute inset-0 opacity-0 shadow-[inset_0_0_0_1px_rgba(125,211,252,0.35),inset_0_-70px_90px_rgba(2,6,23,0.88)] transition duration-300 group-hover:opacity-100" />

      <div className="absolute right-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/45 text-sm text-white shadow-[0_12px_34px_rgba(0,0,0,0.45)] backdrop-blur-md transition group-hover:scale-105 group-hover:border-sky-200/40 group-hover:bg-white/15">
        ▶
      </div>

      <div className="absolute inset-x-0 bottom-0 p-5">
        <LocalizedTitle
          as="h3"
          title={title}
          originalTitle={originalTitle}
          variant="medium"
        />

        <p className="mt-1 line-clamp-1 text-xs font-semibold text-zinc-300">
          S{next.season} · E{next.episode}
          {next.name ? ` · ${next.name}` : ""}
        </p>

        <p className="mt-2 text-[11px] font-semibold text-sky-300">{contextLabel}</p>

        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-violet-300 shadow-[0_0_18px_rgba(167,139,250,0.55)]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="min-w-8 text-right text-xs font-black text-zinc-300">{progress}%</span>
        </div>
      </div>
    </Link>
  );
}

// ─── Seção principal ──────────────────────────────────────────────────────────

export default function ContinueWatchingSection() {
  const { titles, loading: titlesLoading, userId } = useUserData();
  const [items, setItems] = useState<WatchingTitle[]>([]);
  const [loading, setLoading] = useState(true);

  // Carrega uma vez por montagem (F5/navegação). Marcar/desmarcar título não
  // dispara re-fetch — `titles` está intencionalmente fora das dependências.
  const didFetchRef = useRef(false);

  useEffect(() => {
    if (titlesLoading) return;
    if (didFetchRef.current) return;
    didFetchRef.current = true;

    const watchingRaw = titles.filter(
      (t) => t.media_type === "tv" && t.status === "watching",
    );

    if (watchingRaw.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    enrichWatching(watchingRaw, userId)
      .then(setItems)
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titlesLoading, userId]);

  const hasItems = useMemo(() => items.length > 0, [items]);
  if (!loading && !hasItems) return null;

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-white">Continue assistindo</h2>
          <p className="mt-1 text-sm text-zinc-400">Retome suas histórias em andamento.</p>
        </div>

        <Link
          href="/profile?tab=ongoing"
          className="hidden text-xs font-bold text-sky-300 transition hover:text-white md:block"
        >
          Ver todos →
        </Link>
      </div>

      <div className="-mx-6 flex gap-4 overflow-x-auto px-6 pb-4 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:-mx-10 md:px-10">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)
          : items.map((item) => <WatchingCard key={item.id} item={item} />)}
      </div>
    </section>
  );
}

"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, useTransition } from "react";

import SectionHeader from "@/components/ui/SectionHeader";

import type { TitleSeasonInfo, TitleSeriesProgress } from "./types";

type EpisodeDto = {
  episodeNumber: number;
  name: string | null;
  overview: string | null;
  stillUrl: string | null;
  airDate: string | null;
  runtime: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  episodeType: string | null;
};

type SeasonDto = {
  seriesTmdbId: number;
  seasonNumber: number;
  name: string | null;
  overview: string | null;
  posterUrl: string | null;
  airDate: string | null;
  episodeCount: number | null;
  voteAverage: number | null;
  lastSyncedAt: string | null;
  episodes: EpisodeDto[];
};

type TitleEpisodeBrowserProps = {
  seriesTmdbId: number;
  seasons: TitleSeasonInfo[];
  initialSeason?: number | null;
  initialProgress?: TitleSeriesProgress | null;
};

const EPISODES_PER_PAGE = 24;

function formatAirDate(date: string | null) {
  if (!date) return null;

  const d = new Date(date);

  if (!Number.isFinite(d.getTime())) return null;

  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatRuntime(min: number | null) {
  if (!min || !Number.isFinite(min)) return null;

  if (min < 60) return `${min} min`;

  const h = Math.floor(min / 60);
  const m = min % 60;

  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function episodeKey(season: number, episode: number) {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export default function TitleEpisodeBrowser({
  seriesTmdbId,
  seasons,
  initialSeason,
  initialProgress,
}: TitleEpisodeBrowserProps) {
  const seasonNumbers = useMemo(
    () => seasons.map((s) => s.seasonNumber),
    [seasons]
  );

  const [selected, setSelected] = useState<number | null>(() => {
    if (seasons.length === 0) return null;

    if (
      typeof initialSeason === "number" &&
      seasonNumbers.includes(initialSeason)
    ) {
      return initialSeason;
    }

    const now = Date.now();

    const aired = seasons.filter(
      (s) => s.airDate && new Date(s.airDate).getTime() <= now
    );

    if (aired.length > 0) {
      return aired[aired.length - 1].seasonNumber;
    }

    return seasonNumbers[seasonNumbers.length - 1];
  });

  const [season, setSeason] = useState<SeasonDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(EPISODES_PER_PAGE);

  const [watchedKeys, setWatchedKeys] = useState<Set<string>>(
    () => new Set(initialProgress?.watchedKeys ?? [])
  );

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (selected === null) return;

    let cancelled = false;

    setLoading(true);
    setError(null);
    setSeason(null);
    setVisibleCount(EPISODES_PER_PAGE);

    fetch(`/api/poplog3/tv/${seriesTmdbId}/seasons/${selected}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        return (await res.json()) as SeasonDto;
      })
      .then((data) => {
        if (cancelled) return;

        setSeason(data);
      })
      .catch((err) => {
        if (cancelled) return;

        setError(err instanceof Error ? err.message : "Erro desconhecido");
        setSeason(null);
      })
      .finally(() => {
        if (cancelled) return;

        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [seriesTmdbId, selected]);

  useEffect(() => {
    async function refreshProgress(event: Event) {
      const customEvent = event as CustomEvent<{
        seriesTmdbId?: number;
      }>;

      if (customEvent.detail?.seriesTmdbId !== seriesTmdbId) return;

      try {
        const res = await fetch(`/api/poplog3/series/${seriesTmdbId}/progress`);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const body = (await res.json()) as {
          ok?: boolean;
          progress?: {
            watchedKeys?: string[];
          };
          watchedKeys?: string[];
        };

        const nextKeys =
          body.progress?.watchedKeys ??
          body.watchedKeys ??
          [];

        setWatchedKeys(new Set(nextKeys));
      } catch (err) {
        console.warn("[series progress refresh] erro:", err);
      }
    }

    window.addEventListener(
      "poplog3:series-progress-refresh",
      refreshProgress
    );

    return () => {
      window.removeEventListener(
        "poplog3:series-progress-refresh",
        refreshProgress
      );
    };
  }, [seriesTmdbId]);

  if (seasons.length === 0 || selected === null) {
    return null;
  }

  const selectedMeta = seasons.find((s) => s.seasonNumber === selected) ?? null;

  const subtitle =
    season?.name && !/^season\s+\d+$/i.test(season.name)
      ? season.name
      : selectedMeta?.name && !/^season\s+\d+$/i.test(selectedMeta.name)
        ? selectedMeta.name
        : undefined;

  const visibleEpisodes = season?.episodes.slice(0, visibleCount) ?? [];

  const hasMoreEpisodes =
    Boolean(season) && visibleCount < (season?.episodes.length ?? 0);

  function toggleEpisode(
    seasonNumber: number,
    episodeNumber: number,
    nextWatched: boolean,
    runtimeMinutes: number | null
  ) {
    const key = episodeKey(seasonNumber, episodeNumber);

    setWatchedKeys((prev) => {
      const next = new Set(prev);

      if (nextWatched) next.add(key);
      else next.delete(key);

      return next;
    });

    setSavingKey(key);

    startTransition(async () => {
      try {
        const res = await fetch("/api/poplog3/episodes", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            seriesTmdbId,
            seasonNumber,
            episodeNumber,
            watched: nextWatched,
            runtimeMinutes,
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const body = (await res.json()) as {
          ok: boolean;
          progress?: {
            watchedKeys?: string[];
          };
        };

        if (body.ok && body.progress?.watchedKeys) {
          setWatchedKeys(new Set(body.progress.watchedKeys));
        }
      } catch (err) {
        setWatchedKeys((prev) => {
          const next = new Set(prev);

          if (nextWatched) next.delete(key);
          else next.add(key);

          return next;
        });

        console.warn("[episode toggle] erro:", err);
      } finally {
        setSavingKey(null);
      }
    });
  }

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader
        eyebrow={`${seasons.length} ${
          seasons.length === 1 ? "temporada" : "temporadas"
        }`}
        title="Episódios"
        subtitle={subtitle}
        accent="indigo"
      />

      <div className="flex flex-wrap gap-2">
        {seasons.map((s) => {
          const active = s.seasonNumber === selected;

          const futureNoEps =
            (!s.episodeCount || s.episodeCount === 0) &&
            s.airDate &&
            new Date(s.airDate).getTime() > Date.now();

          return (
            <button
              key={s.seasonNumber}
              type="button"
              onClick={() => setSelected(s.seasonNumber)}
              title={
                futureNoEps
                  ? `Estreia ${formatAirDate(s.airDate)}`
                  : undefined
              }
              className={[
                "rounded-full border px-3.5 py-1.5 text-[12px] font-semibold tracking-[-0.01em] transition duration-200 backdrop-blur-md",
                active
                  ? "border-indigo-300/45 bg-indigo-500/22 text-indigo-50 shadow-[0_0_24px_rgba(129,140,248,0.22)]"
                  : "border-white/[0.08] bg-white/[0.04] text-white/72 hover:border-white/[0.18] hover:bg-white/[0.08] hover:text-white",
              ].join(" ")}
            >
              T{String(s.seasonNumber).padStart(2, "0")}

              {futureNoEps && (
                <span className="ml-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-amber-200/80">
                  ●
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading && !season && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[170px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025]"
            />
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-2xl border border-rose-300/22 bg-rose-500/12 p-4 text-[13px] text-rose-100/90">
          Não consegui carregar esta temporada: {error}
        </p>
      )}

      {season && season.episodes.length > 0 && (
        <>
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {visibleEpisodes.map((ep) => {
              const key = episodeKey(selected, ep.episodeNumber);
              const watched = watchedKeys.has(key);
              const saving = savingKey === key;

              return (
                <EpisodeCard
                  key={ep.episodeNumber}
                  episode={ep}
                  seasonNumber={selected}
                  watched={watched}
                  saving={saving}
                  onToggle={(next) =>
                    toggleEpisode(
                      selected,
                      ep.episodeNumber,
                      next,
                      ep.runtime ?? null
                    )
                  }
                />
              );
            })}
          </div>

          {hasMoreEpisodes && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((prev) => prev + EPISODES_PER_PAGE)
                }
                className="rounded-2xl border border-white/[0.10] bg-white/[0.04] px-5 py-3 text-[13px] font-semibold text-white/82 transition hover:border-white/[0.20] hover:bg-white/[0.08]"
              >
                Carregar mais episódios
              </button>
            </div>
          )}
        </>
      )}

      {season && season.episodes.length === 0 && (
        <UpcomingSeasonNotice seasonMeta={selectedMeta} />
      )}
    </section>
  );
}

function UpcomingSeasonNotice({
  seasonMeta,
}: {
  seasonMeta: TitleSeasonInfo | null;
}) {
  const airDate = formatAirDate(seasonMeta?.airDate ?? null);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-300/18 bg-amber-500/[0.06] p-5 sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(251,191,36,0.16),transparent_50%)]"
        aria-hidden
      />

      <div className="relative flex flex-col gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-200/80">
          Em breve
        </p>

        <h3 className="text-[15px] font-bold tracking-[-0.02em] text-white sm:text-base">
          Episódios ainda não anunciados
        </h3>

        <p className="text-[13px] leading-6 text-white/55">
          {airDate
            ? `Esta temporada estreia em ${airDate}. Os episódios são publicados no TMDB conforme se aproximam da estreia.`
            : "A produção ainda não divulgou episódios desta temporada. Tudo aparece aqui assim que o TMDB liberar."}
        </p>
      </div>
    </div>
  );
}

type EpisodeCardProps = {
  episode: EpisodeDto;
  seasonNumber: number;
  watched: boolean;
  saving: boolean;
  onToggle: (next: boolean) => void;
};

function EpisodeCard({
  episode,
  seasonNumber,
  watched,
  saving,
  onToggle,
}: EpisodeCardProps) {
  const airDate = formatAirDate(episode.airDate);
  const runtime = formatRuntime(episode.runtime);
  const isFinale = episode.episodeType === "finale";
  const isPremiere =
    episode.episodeType === "season_premiere" ||
    episode.episodeType === "premiere";

  const aired =
    !episode.airDate || new Date(episode.airDate).getTime() <= Date.now();

  return (
    <article
      className={[
        "group flex flex-col overflow-hidden rounded-[1.25rem] border backdrop-blur-md transition duration-300 sm:flex-row",
        watched
          ? "border-emerald-300/22 bg-emerald-500/[0.06] hover:border-emerald-300/35 hover:bg-emerald-500/[0.10]"
          : "border-white/[0.08] bg-white/[0.025] hover:border-white/[0.18] hover:bg-white/[0.055]",
      ].join(" ")}
    >
      <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-zinc-900 sm:aspect-auto sm:w-[200px]">
        {episode.stillUrl ? (
          <Image
            src={episode.stillUrl}
            alt={episode.name ?? `Episódio ${episode.episodeNumber}`}
            fill
            unoptimized
            sizes="(max-width: 640px) 100vw, 200px"
            className={[
              "object-cover transition duration-500 group-hover:scale-[1.04]",
              watched
                ? "brightness-[0.6] saturate-[0.9]"
                : "brightness-[0.86] saturate-[1.06] group-hover:brightness-100",
            ].join(" ")}
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-zinc-900 to-zinc-950 text-[10px] uppercase tracking-[0.2em] text-white/30">
            Sem thumb
          </div>
        )}

        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/72 via-black/12 to-transparent"
          aria-hidden
        />

        <div className="absolute left-2.5 top-2.5 rounded-md border border-white/[0.12] bg-black/65 px-2 py-0.5 text-[10px] font-black tracking-[0.06em] text-white/85 backdrop-blur-md">
          S{String(seasonNumber).padStart(2, "0")}E
          {String(episode.episodeNumber).padStart(2, "0")}
        </div>

        {(isFinale || isPremiere) && (
          <div
            className={`absolute right-2.5 top-2.5 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] backdrop-blur-md ${
              isFinale
                ? "border-rose-300/30 bg-rose-500/22 text-rose-100"
                : "border-cyan-300/30 bg-cyan-500/22 text-cyan-100"
            }`}
          >
            {isFinale ? "Final" : "Estreia"}
          </div>
        )}

        {watched && (
          <div className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-500/22 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-100 backdrop-blur-md">
            <span aria-hidden>✓</span> Visto
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-[14px] font-bold tracking-[-0.015em] text-white sm:text-[15px]">
            {episode.name ?? `Episódio ${episode.episodeNumber}`}
          </h3>

          {typeof episode.voteAverage === "number" &&
            episode.voteAverage > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300/22 bg-amber-400/10 px-2 py-0.5 text-[10px] font-black text-amber-100">
                <span aria-hidden>★</span>
                {episode.voteAverage.toFixed(1)}
              </span>
            )}
        </div>

        <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
          {airDate && <span>{airDate}</span>}

          {airDate && runtime && (
            <span aria-hidden className="text-white/20">
              ·
            </span>
          )}

          {runtime && <span>{runtime}</span>}
        </div>

        {episode.overview && (
          <p className="line-clamp-3 text-[12.5px] leading-[1.55] text-white/65">
            {episode.overview}
          </p>
        )}

        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => onToggle(!watched)}
            disabled={!aired || saving}
            aria-pressed={watched}
            className={[
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition duration-200",
              !aired
                ? "cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-white/30"
                : watched
                  ? "border-emerald-300/30 bg-emerald-500/15 text-emerald-100 hover:border-emerald-300/45 hover:bg-emerald-500/25"
                  : "border-white/[0.10] bg-white/[0.04] text-white/72 hover:border-white/[0.20] hover:bg-white/[0.08] hover:text-white",
              saving ? "cursor-wait opacity-70" : "",
            ].join(" ")}
          >
            {saving ? (
              <span
                className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
                aria-hidden
              />
            ) : watched ? (
              <>
                <span aria-hidden>✓</span> Assistido
              </>
            ) : !aired ? (
              "Não estreou"
            ) : (
              "Marcar como visto"
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
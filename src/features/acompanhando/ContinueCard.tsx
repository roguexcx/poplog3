"use client";

import { useRandomizedTitleDisplay } from "@/components/titles/LocalizedTitle";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";
import CardProviderBadge from "@/components/ui/CardProviderBadge";

export type ContinueStatusSignal =
  | "new_episode"
  | "last_episode"
  | "reta_final"
  | "continuing";

export type ContinueItem = {
  content_id: string;
  tmdb_id: number;
  title: string;
  original_title?: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  computed_state: string;
  watched_episodes: number;
  aired_episodes: number;
  episodes_behind: number;
  progress_pct: number;
  next_season: number;
  next_episode: number;
  next_episode_name: string | null;
  next_episode_still_path: string | null;
  next_episode_air_date: string | null;
  last_watched_at: string | null;
  remaining_minutes: number | null;
  remaining_runtime_label: string | null;
  /** Tempo restante de toda a série (todos eps aired) */
  series_remaining_minutes: number | null;
  series_remaining_runtime_label: string | null;
  status_signal: ContinueStatusSignal;
  runtime: number | null;
  runtime_label: string | null;
  /** Episódios assistidos na temporada atual (= next_episode - 1) */
  season_watched: number;
  /** Total de episódios na temporada atual — null se não sincronizado */
  season_total: number | null;
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
};

type Props = {
  item: ContinueItem;
  onClick: () => void;
  /** Modo de ordenação da seção — afeta qual tempo é priorizado no badge inferior */
  sortMode?: "recent" | "season" | "series";
};

function formatCatchUpLabel(label?: string | null) {
  return label?.replace(/\s*restantes$/i, " para ficar em dia") ?? null;
}

const SIGNAL_CONFIG: Record<
  ContinueStatusSignal,
  { label: string | null; color: string; bar: string }
> = {
  new_episode: {
    label: "Novo episódio disponível",
    color: "text-rose-300/90",
    bar: "from-rose-400 via-pink-400 to-fuchsia-400",
  },
  last_episode: {
    label: "Último episódio disponível",
    color: "text-amber-300/85",
    bar: "from-amber-400 to-yellow-400",
  },
  reta_final: {
    label: null, // montado dinamicamente
    color: "text-amber-300/85",
    bar: "from-amber-400 to-yellow-400",
  },
  continuing: {
    label: null,
    color: "",
    bar: "from-indigo-400 via-violet-400 to-purple-400",
  },
};

export default function ContinueCard({ item, onClick }: Props) {
  const { mainTitle } = useRandomizedTitleDisplay(item.title, item.original_title);

  const posterUrl = resolveCatalogImage(item.poster_path, "w185");

  const backdropUrl =
    resolveCatalogImage(item.next_episode_still_path, "w780") ??
    resolveCatalogImage(item.backdrop_path, "w780");

  const cfg = SIGNAL_CONFIG[item.status_signal];
  const seasonPct =
    item.season_total != null && item.season_total > 0
      ? Math.min(100, Math.round((item.season_watched / item.season_total) * 100))
      : null;
  const progressPct = seasonPct ?? Math.min(100, Math.max(0, item.progress_pct));

  const statusLabel =
    item.status_signal === "reta_final"
      ? `Reta final · ${item.episodes_behind} eps restantes`
      : cfg.label;

  const isNewEp = item.status_signal === "new_episode";

  // Badge inferior: sempre mostra o tempo restante da temporada atual
  const activeRuntimeLabel = item.remaining_runtime_label
    ? item.remaining_runtime_label.replace(/\s*restantes$/i, " restantes na temporada")
    : null;
  // Badge ao lado do título: tempo total para ficar em dia com a série
  const catchUpRuntimeLabel = formatCatchUpLabel(
    item.series_remaining_runtime_label ?? item.remaining_runtime_label,
  );
  const seasonProgressLabel =
    item.season_total != null
      ? `${item.season_watched} de ${item.season_total} eps na T${item.next_season}`
      : null;


  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-900/80 text-left transition-all hover:border-white/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
    >
      {/* Backdrop (right side) */}
      {backdropUrl && (
        <div className="absolute inset-0 -z-0">
          <img
            src={backdropUrl}
            alt=""
            className="h-full w-full object-cover object-center opacity-25 brightness-75 transition-opacity group-hover:opacity-35"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/95 via-zinc-950/70 to-zinc-950/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-transparent to-transparent" />
        </div>
      )}

      <div className="relative flex min-h-[92px] items-stretch gap-0">
        {/* Poster */}
        {posterUrl && (
          <div className="relative shrink-0 self-stretch overflow-hidden rounded-l-2xl"
            style={{ width: 62 }}
          >
            <img
              src={posterUrl}
              alt=""
              className="h-full w-full object-cover"
            />
            {/* Episode tag overlay */}
            <div className="absolute bottom-0 inset-x-0 flex justify-center pb-1.5">
              <span className="rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-black text-white/90 backdrop-blur-sm">
                T{item.next_season}E{item.next_episode}
              </span>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col justify-between px-3.5 py-3 sm:px-4">
          {/* Top row: badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            {isNewEp && (
              <span className="inline-flex items-center rounded-full bg-rose-500 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-white">
                NOVO EP
              </span>
            )}
            {!posterUrl && (
              <span className="rounded-full border border-white/[0.15] bg-white/[0.07] px-2 py-0.5 text-[10px] font-bold text-white/70">
                T{item.next_season}E{item.next_episode}
              </span>
            )}
            <span className="rounded-full bg-indigo-500/25 px-2.5 py-0.5 text-[10px] font-black tracking-[0.06em] text-indigo-200/90 ring-1 ring-indigo-400/30">
              CONTINUAR
            </span>
            {item.best_provider_name && (
              <CardProviderBadge
                name={item.best_provider_name}
                logoPath={item.best_provider_logo}
                type={item.best_provider_type}
              />
            )}
          </div>

          {/* Title + episode name */}
          <div className="mt-1 min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="min-w-0 truncate text-[13px] font-black leading-tight text-white">
                {mainTitle}
              </p>
              {catchUpRuntimeLabel && (
                <span
                  title={catchUpRuntimeLabel}
                  className="max-w-[48%] shrink-0 truncate rounded-full border border-white/[0.10] bg-white/[0.055] px-1.5 py-px text-[9px] font-bold leading-tight text-white/50"
                >
                  {catchUpRuntimeLabel}
                </span>
              )}
            </div>
            {item.next_episode_name && (
              <p className="mt-0.5 truncate text-[11px] leading-tight text-white/48">
                &ldquo;{item.next_episode_name}&rdquo;
              </p>
            )}
            {(seasonProgressLabel || activeRuntimeLabel) && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-white/35">
                {seasonProgressLabel && (
                  <span className="shrink-0">{seasonProgressLabel}</span>
                )}
                {activeRuntimeLabel && (
                  <span className="inline-flex shrink-0 items-center rounded-full px-1.5 py-px">
                    <span className="font-medium">{activeRuntimeLabel}</span>
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Bottom row: status + progress */}
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {statusLabel ? (
              <p className={`truncate text-[11px] font-semibold leading-none ${cfg.color}`}>
                {statusLabel}
              </p>
            ) : (
              <span />
            )}
            {progressPct > 0 && (
              <span className="shrink-0 text-[11px] font-bold tabular-nums text-white/40">
                {progressPct}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-[3px] w-full overflow-hidden bg-white/[0.05]">
        {progressPct > 0 && (
          <div
            className={`absolute inset-y-0 left-0 bg-gradient-to-r ${cfg.bar}`}
            style={{ width: `${progressPct}%` }}
          />
        )}
      </div>
    </button>
  );
}

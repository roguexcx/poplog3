import {
  formatAvailabilityState,
  seriesStateToBadgeVariant,
  type SeriesState,
} from "@/lib/series";
import StatusBadge from "@/components/ui/StatusBadge";

import type { TitlePageData } from "./types";

type TitleSeasonsCardProps = {
  title: TitlePageData;
};

function formatAirDate(date: string | null | undefined) {
  if (!date) return null;

  const d = new Date(date);

  if (!Number.isFinite(d.getTime())) return null;

  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function episodeCode(season?: number | null, episode?: number | null) {
  if (typeof season !== "number" || typeof episode !== "number") {
    return null;
  }

  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(
    2,
    "0"
  )}`;
}

function statusLabel(seriesState: SeriesState) {
  if (seriesState === "in-season") return "No ar";
  if (seriesState === "episode-available") return "Novo episódio";
  if (seriesState === "finished") return "Encerrada";
  if (seriesState === "coming-soon") return "Em breve";
  if (seriesState === "awaiting-next-season") return "Entre temporadas";

  return formatAvailabilityState(seriesState);
}

function titleByState(seriesState: SeriesState, hasNext: boolean) {
  if (hasNext) return "Próximo episódio";
  if (seriesState === "finished") return "Série encerrada";
  if (seriesState === "coming-soon") return "Estreia em breve";
  if (seriesState === "episode-available") return "Novo episódio disponível";
  if (seriesState === "in-season") return "Série no ar";
  return "Aguardando novidades";
}

export default function TitleSeasonsCard({ title }: TitleSeasonsCardProps) {
  if (title.mediaType !== "tv") return null;

  const seriesState =
    (title.availabilityState as SeriesState | undefined) ?? "unknown";

  const next = title.nextEpisode;
  const seasons = title.numberOfSeasons ?? null;
  const episodes = title.numberOfEpisodes ?? null;

  const code = episodeCode(next?.season_number, next?.episode_number);
  const isFinale = next?.episode_type === "finale";
  const hasNext = Boolean(next?.air_date || next?.name || code);

  return (
    <section className="relative overflow-hidden rounded-[1.5rem] border border-white/[0.08] bg-white/[0.035] p-6 backdrop-blur-xl sm:p-8">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_30%,rgba(99,102,241,0.12),transparent_45%)]"
        aria-hidden
      />

      <div
        className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
        aria-hidden
      />

      <div className="relative grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200/70">
              Status da série
            </p>

            {seriesState !== "unknown" && (
              <StatusBadge
                variant={seriesStateToBadgeVariant(seriesState)}
                label={statusLabel(seriesState)}
                size="xs"
              />
            )}

            {hasNext && (
              <StatusBadge
                variant="new-episode"
                label="Novo episódio"
                size="xs"
              />
            )}

            {isFinale && (
              <StatusBadge
                variant="in-season"
                label="Final de temporada"
                size="xs"
              />
            )}
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <h3 className="text-[22px] font-black leading-tight tracking-[-0.04em] text-white sm:text-2xl">
              {next?.name ?? titleByState(seriesState, hasNext)}
            </h3>

            {hasNext && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-6 text-white/62 sm:text-[14px]">
                {code && (
                  <span className="rounded-md border border-white/[0.08] bg-white/[0.045] px-2 py-0.5 text-[11px] font-black tracking-[0.12em] text-white/85">
                    {code}
                  </span>
                )}

                {isFinale && (
                  <span className="rounded-md border border-rose-300/20 bg-rose-500/12 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-rose-100/90">
                    Finale
                  </span>
                )}

                {next?.air_date && <span>{formatAirDate(next.air_date)}</span>}
              </div>
            )}

            {isFinale && (
              <p className="text-[13px] font-semibold leading-5 text-rose-100/72">
                Encerramento da temporada atual.
              </p>
            )}
          </div>
        </div>

        {(seasons !== null || episodes !== null) && (
          <div className="flex gap-3 sm:gap-4">
            {seasons !== null && <Stat label="Temporadas" value={seasons} />}
            {episodes !== null && <Stat label="Episódios" value={episodes} />}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[88px] rounded-2xl border border-white/[0.08] bg-black/25 p-3 text-center sm:p-4">
      <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-white/45 sm:text-[10px]">
        {label}
      </p>

      <p className="mt-1 text-2xl font-black tracking-[-0.04em] text-white sm:text-3xl">
        {value}
      </p>
    </div>
  );
}
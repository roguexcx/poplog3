import ContextualAttribution from "@/components/attribution/ContextualAttribution";
import { getRatingSourceIds } from "@/attribution/helpers";
import type { TitleRatings } from "./types";

type TitleScoreCardProps = {
  ratings?: TitleRatings | null;
};

type VisibleRating = {
  label: string;
  value: string;
  suffix?: string;
  footnote?: string;
};

function formatVotes(votes?: number | null): string | null {
  if (!votes || !Number.isFinite(votes)) return null;
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M`;
  if (votes >= 1_000) return `${(votes / 1_000).toFixed(0)}k`;
  return String(votes);
}

function scoreTone(score: number): {
  ring: string;
  text: string;
  glow: string;
  pill: string;
} {
  if (score >= 8.5) {
    return {
      ring: "from-emerald-300/80 via-cyan-300/60 to-violet-300/70",
      text: "text-emerald-100",
      glow: "shadow-[0_0_60px_rgba(52,211,153,0.30)]",
      pill: "bg-emerald-500/15 border-emerald-300/30 text-emerald-100",
    };
  }

  if (score >= 7) {
    return {
      ring: "from-cyan-300/80 via-indigo-300/60 to-fuchsia-300/70",
      text: "text-cyan-100",
      glow: "shadow-[0_0_50px_rgba(34,211,238,0.25)]",
      pill: "bg-cyan-500/15 border-cyan-300/30 text-cyan-100",
    };
  }

  if (score >= 5.5) {
    return {
      ring: "from-amber-300/80 via-orange-300/60 to-rose-300/70",
      text: "text-amber-100",
      glow: "shadow-[0_0_46px_rgba(251,191,36,0.22)]",
      pill: "bg-amber-500/15 border-amber-300/30 text-amber-100",
    };
  }

  return {
    ring: "from-rose-300/80 via-rose-300/60 to-fuchsia-300/70",
    text: "text-rose-100",
    glow: "shadow-[0_0_44px_rgba(244,114,182,0.22)]",
    pill: "bg-rose-500/15 border-rose-300/30 text-rose-100",
  };
}

export default function TitleScoreCard({ ratings }: TitleScoreCardProps) {
  if (!ratings) return null;

  const score = ratings.poplogScore ?? null;
  const tone = score !== null ? scoreTone(score) : null;
  const votes = formatVotes(ratings.imdbVotes);

  const rawRatings: (VisibleRating | null)[] = [
    typeof ratings.imdbRating === "number"
      ? {
          label: "IMDb",
          value: ratings.imdbRating.toFixed(1),
          suffix: "/10",
          footnote: votes ? `${votes} votos` : undefined,
        }
      : null,

    typeof ratings.rottenTomatoesScore === "number"
      ? {
          label: "Rotten Tom.",
          value: String(ratings.rottenTomatoesScore),
          suffix: "%",
        }
      : null,

    typeof ratings.metacriticScore === "number"
      ? {
          label: "Metacritic",
          value: String(ratings.metacriticScore),
          suffix: "/100",
        }
      : null,

    typeof ratings.tmdbRating === "number"
      ? {
          label: "TMDB",
          value: ratings.tmdbRating.toFixed(1),
          suffix: "/10",
        }
      : null,
  ];
  const visibleRatings: VisibleRating[] = rawRatings.filter(
    (item): item is VisibleRating => item !== null
  );

  if (score === null && visibleRatings.length === 0) {
    return null;
  }

  const componentsUsed =
    ratings.poplogComponents ?? visibleRatings.length;
  const sourcesUsed = getRatingSourceIds(ratings);

  return (
    <section className="relative overflow-hidden rounded-[1.5rem] border border-white/[0.08] bg-white/[0.035] p-5 backdrop-blur-xl sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.10),transparent_45%),radial-gradient(circle_at_92%_100%,rgba(244,114,182,0.08),transparent_45%)]"
        aria-hidden
      />

      <div
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
        aria-hidden
      />

      <div className="relative">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-indigo-300/80">
            <span aria-hidden className="text-[13px]">{"★"}</span>
            <span className="text-xs font-black uppercase tracking-[0.18em]">
              Notas
            </span>
          </div>
          <ContextualAttribution
            context="ratings"
            sourcesUsed={sourcesUsed}
          />
        </div>

        <div className="flex items-center gap-4">
          {score !== null && tone ? (
            <div
              className={`relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-white/[0.10] bg-black/40 ${tone.glow}`}
            >
              <div
                className={`pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br ${tone.ring} opacity-20`}
                aria-hidden
              />

              <div className="relative text-center">
                <p
                  className={`text-2xl font-black leading-none tracking-[-0.04em] ${tone.text}`}
                >
                  {score.toFixed(1)}
                </p>

                <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-white/45">
                  / 10
                </p>
              </div>
            </div>
          ) : (
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-white/[0.08] bg-black/30 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
              s/d
            </div>
          )}

          <div className="min-w-0 flex-1">
            {score !== null ? (
              <p className="text-[12px] leading-[1.5] text-white/60">
                Score POPLOG baseado em{" "}
                <span className="font-semibold text-white/80">
                  {componentsUsed}
                </span>{" "}
                {componentsUsed === 1 ? "fonte" : "fontes"}.
              </p>
            ) : (
              <p className="text-[12px] leading-[1.5] text-white/45">
                Ratings não sincronizados.
              </p>
            )}
          </div>
        </div>

        {visibleRatings.length > 0 && (
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {visibleRatings.map((item) => (
              <ScoreCell
                key={item.label}
                label={item.label}
                value={item.value}
                suffix={item.suffix}
                footnote={item.footnote}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

type ScoreCellProps = {
  label: string;
  value: string;
  suffix?: string;
  footnote?: string;
};

function ScoreCell({ label, value, suffix, footnote }: ScoreCellProps) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/25 p-2.5 sm:p-3">
      <p className="truncate text-[8px] font-bold uppercase tracking-[0.16em] text-white/40 sm:text-[10px]">
        {label}
      </p>

      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-lg font-black tracking-[-0.04em] text-white sm:text-xl">
          {value}
        </span>

        {suffix && (
          <span className="text-[10px] font-bold text-white/40">
            {suffix}
          </span>
        )}
      </div>

      {footnote && (
        <p className="mt-0.5 truncate text-[9px] font-semibold text-white/35">
          {footnote}
        </p>
      )}
    </div>
  );
}

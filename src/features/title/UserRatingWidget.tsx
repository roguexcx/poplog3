"use client";

/**
 * Card principal de avaliação da página de título.
 * Integra avaliação pessoal, índice geral e referências de apoio.
 */

import StarRating from "@/components/ui/StarRating";
import { useUserRating } from "@/hooks/useUserRating";
import {
  buildGeneralIndexSources,
  calculateGeneralIndex,
  type GeneralIndexSource,
  type GeneralIndexSourceId,
} from "@/lib/ratings/general-index";
import type { TitleMediaType, TitleRatings } from "./types";
import type { UserRatingData, CommunityRatingData } from "@/types/user";
import type { RatingMediaType } from "@/types/user";

type UserRatingWidgetProps = {
  mediaType: TitleMediaType;
  tmdbId: number;
  poplogId?: string | number | null;
  imdbId?: string | null;
  slug?: string | null;
  userRating?: UserRatingData | null;
  communityRating?: CommunityRatingData | null;
  ratings?: TitleRatings | null;
  isAuthenticated?: boolean;
  onCommunityRatingChange?: (rating: CommunityRatingData | null) => void;
};

type RatingSourceChip = {
  id: GeneralIndexSourceId;
  icon: string;
  label: string;
  value: string;
  detail?: string;
  score: number;
  weight: number;
  poplog?: boolean;
};

const SOURCE_ICONS: Record<GeneralIndexSourceId, string> = {
  poplog: "🍿",
  imdb: "🎞",
  tmdb: "🎬",
  rotten: "🍅",
  metacritic: "✒",
};

function buildRatingSourceChips({
  communityRating,
  ratings,
}: {
  communityRating?: CommunityRatingData | null;
  ratings?: TitleRatings | null;
}): RatingSourceChip[] {
  return buildGeneralIndexSources({ communityRating, ratings }).map(
    (source: GeneralIndexSource) => ({
      ...source,
      icon: SOURCE_ICONS[source.id],
    }),
  );
}

function sourceSummary(ratings?: TitleRatings | null): string {
  if (!ratings) return "com referências externas";

  const hasOmdb =
    typeof ratings.imdbRating === "number" ||
    typeof ratings.rottenTomatoesScore === "number" ||
    typeof ratings.metacriticScore === "number";
  const hasTmdb = typeof ratings.tmdbRating === "number";

  if (hasOmdb && hasTmdb) return "via OMDb + TMDB";
  if (hasOmdb) return "via OMDb";
  if (hasTmdb) return "via TMDB";
  return "com referências externas";
}

export default function UserRatingWidget({
  mediaType,
  tmdbId,
  poplogId = null,
  imdbId = null,
  slug = null,
  userRating: initialUserRating,
  communityRating,
  ratings,
  isAuthenticated = false,
  onCommunityRatingChange,
}: UserRatingWidgetProps) {
  const ratingMediaType = mediaType as RatingMediaType;

  const { rating, isPending, error, selectRating, clearRating } = useUserRating({
    mediaType: ratingMediaType,
    tmdbId,
    poplogId,
    imdbId,
    slug,
    initialRating: initialUserRating,
    isAuthenticated,
    onCommunityRatingChange,
  });

  const hasPersonalRating = rating !== null;
  const sourceChips = buildRatingSourceChips({ communityRating, ratings });
  const generalIndex = calculateGeneralIndex(sourceChips);
  const indexDescription =
    sourceChips.length === 1
      ? `Baseado em ${sourceChips[0].label} até haver outra referência.`
      : "Combina as fontes disponíveis em escala /10.";

  return (
    <section className="relative overflow-hidden rounded-[1.5rem] border border-white/[0.09] bg-zinc-950/90 p-5 shadow-[0_22px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(250,204,21,0.10),transparent_38%),radial-gradient(circle_at_100%_100%,rgba(255,255,255,0.045),transparent_42%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-yellow-300/25 to-transparent"
        aria-hidden
      />

      <div className="relative space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-yellow-300">
            <span aria-hidden className="text-[13px]">
              ★
            </span>
            <span className="text-xs font-black uppercase tracking-[0.18em]">
              Avaliação POPLOG
            </span>
          </div>

          <span className="text-right text-[10px] font-semibold text-white/38">
            {sourceSummary(ratings)}
          </span>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
            Sua avaliação
          </p>

          {isAuthenticated ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <StarRating
                  value={rating}
                  size="md"
                  interactive
                  onChange={selectRating}
                  ariaLabel="Selecione sua avaliação de 0 a 5 estrelas"
                />

                {hasPersonalRating ? (
                  <span className="text-[15px] font-black tabular-nums tracking-tight text-yellow-300">
                    {rating!.toFixed(1)}{" "}
                    <span className="text-[10px] font-bold text-white/42">
                      /5
                    </span>
                  </span>
                ) : (
                  <span className="text-[12px] text-white/35">
                    Toque para avaliar
                  </span>
                )}

                {hasPersonalRating && (
                  <button
                    type="button"
                    onClick={clearRating}
                    className="ml-auto rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[10px] font-semibold text-white/45 transition hover:border-rose-400/30 hover:text-rose-300/85"
                    aria-label="Remover avaliação"
                  >
                    Remover
                  </button>
                )}
              </div>

              {isPending && (
                <p className="text-[10px] text-white/35 animate-pulse">
                  Salvando…
                </p>
              )}

              {error && <p className="text-[10px] text-rose-400">{error}</p>}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <StarRating value={null} size="md" interactive={false} />
              <span className="text-[12px] text-white/35">
                Entre para avaliar
              </span>
            </div>
          )}
        </div>

        <div className="h-px bg-white/[0.07]" />

        {generalIndex !== null ? (
          <div className="py-3 text-center">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-6xl font-black leading-none tracking-[-0.055em] text-white sm:text-7xl">
                {generalIndex.toFixed(1)}
              </span>
              <span className="text-base font-bold text-white/42 sm:text-lg">
                /10
              </span>
            </div>

            <p className="mt-3 text-[10px] font-black uppercase tracking-[0.18em] text-yellow-200/70">
              Índice geral
            </p>
            <p className="mx-auto mt-1 max-w-[260px] text-[12px] leading-relaxed text-white/52">
              {indexDescription}
            </p>
          </div>
        ) : (
          <div className="py-2">
            <p className="text-[12px] leading-relaxed text-white/45">
              O índice geral aparece quando houver ao menos uma fonte de
              avaliação disponível.
            </p>
          </div>
        )}

        {sourceChips.length > 0 && (
          <>
            <div className="h-px bg-white/[0.07]" />

            <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] leading-5 text-white/56">
              {sourceChips.map((source) => (
                <SourceChip key={source.id} source={source} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function SourceChip({ source }: { source: RatingSourceChip }) {
  return (
    <span
      className={[
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap",
        source.poplog ? "font-semibold text-yellow-200/85" : "text-white/52",
      ].join(" ")}
    >
      <span aria-hidden className="text-[12px] opacity-80">
        {source.icon}
      </span>
      <span className="truncate">
        <span className={source.poplog ? "text-yellow-200" : "text-white/65"}>
          {source.label}
        </span>{" "}
        {source.value}
        {source.detail ? (
          <span className="text-white/38"> · {source.detail}</span>
        ) : null}
      </span>
    </span>
  );
}

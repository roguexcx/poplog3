import type { CommunityRatingData } from "@/types/user";

export type GeneralIndexRatingInput = {
  imdbRating?: number | null;
  rottenTomatoesScore?: number | null;
  metacriticScore?: number | null;
  tmdbRating?: number | null;
};

export type GeneralIndexSourceId =
  | "poplog"
  | "imdb"
  | "tmdb"
  | "rotten"
  | "metacritic";

export type GeneralIndexSource = {
  id: GeneralIndexSourceId;
  label: string;
  value: string;
  detail?: string;
  score: number;
  weight: number;
  poplog?: boolean;
};

const INDEX_WEIGHTS: Record<GeneralIndexSourceId, number> = {
  poplog: 0.2,
  imdb: 0.25,
  tmdb: 0.2,
  rotten: 0.2,
  metacritic: 0.15,
};

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function formatCompactCommunityCount(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "avaliação" : "avaliações"}`;
}

function isValidIndexScore(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function buildGeneralIndexSources({
  communityRating,
  ratings,
}: {
  communityRating?: CommunityRatingData | null;
  ratings?: GeneralIndexRatingInput | null;
}): GeneralIndexSource[] {
  const sources: Array<GeneralIndexSource | null> = [
    communityRating &&
    communityRating.ratingCount > 0 &&
    isValidIndexScore(communityRating.averageRating)
      ? {
          id: "poplog",
          label: "POPLOG",
          value: `${communityRating.averageRating.toFixed(1)}/5`,
          detail: formatCompactCommunityCount(communityRating.ratingCount),
          score: communityRating.averageRating * 2,
          weight: INDEX_WEIGHTS.poplog,
          poplog: true,
        }
      : null,
    isValidIndexScore(ratings?.imdbRating)
      ? {
          id: "imdb",
          label: "IMDb",
          value: ratings.imdbRating.toFixed(1),
          score: ratings.imdbRating,
          weight: INDEX_WEIGHTS.imdb,
        }
      : null,
    isValidIndexScore(ratings?.rottenTomatoesScore)
      ? {
          id: "rotten",
          label: "Rotten",
          value: `${ratings.rottenTomatoesScore}%`,
          score: ratings.rottenTomatoesScore / 10,
          weight: INDEX_WEIGHTS.rotten,
        }
      : null,
    isValidIndexScore(ratings?.metacriticScore)
      ? {
          id: "metacritic",
          label: "Metacritic",
          value: String(ratings.metacriticScore),
          score: ratings.metacriticScore / 10,
          weight: INDEX_WEIGHTS.metacritic,
        }
      : null,
    isValidIndexScore(ratings?.tmdbRating)
      ? {
          id: "tmdb",
          label: "TMDB",
          value: ratings.tmdbRating.toFixed(1),
          score: ratings.tmdbRating,
          weight: INDEX_WEIGHTS.tmdb,
        }
      : null,
  ];

  return sources.filter((source): source is GeneralIndexSource => source !== null);
}

export function calculateGeneralIndex(
  sources: GeneralIndexSource[],
): number | null {
  if (sources.length === 0) return null;
  if (sources.length === 1) return Math.round(sources[0].score * 10) / 10;

  const availableWeight = sources.reduce(
    (sum, source) => sum + source.weight,
    0,
  );
  if (availableWeight <= 0) return null;

  const weightedScore =
    sources.reduce((sum, source) => sum + source.score * source.weight, 0) /
    availableWeight;

  return Math.round(weightedScore * 10) / 10;
}

export function getGeneralIndex(input: {
  communityRating?: CommunityRatingData | null;
  ratings?: GeneralIndexRatingInput | null;
}): number | null {
  return calculateGeneralIndex(buildGeneralIndexSources(input));
}

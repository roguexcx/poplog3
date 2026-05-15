/**
 * POPLOG Score — nota proprietaria ponderada a partir de ratings externos.
 *
 * Filosofia:
 * - Tudo eh normalizado pra escala 0-10 antes de combinar.
 * - Pesos base:
 *   IMDb        40%
 *   Rotten Tom  30%
 *   Metacritic  20%
 *   TMDB        10%
 * - Se uma fonte estiver ausente, os pesos das fontes disponíveis
 *   são redistribuídos proporcionalmente.
 * - Score só existe quando pelo menos uma fonte válida existe.
 */

export type PoplogScoreInput = {
  /** IMDb rating em escala 0-10. */
  imdb?: number | null;

  /** Rotten Tomatoes em escala 0-100. */
  rottenTomatoes?: number | null;

  /** Metacritic em escala 0-100. */
  metacritic?: number | null;

  /** TMDB rating em escala 0-10. */
  tmdb?: number | null;
};

export type PoplogScoreBreakdown = {
  /** Score final em escala 0-10. */
  score: number;

  /** Quantas fontes entraram no cálculo. */
  componentsUsed: number;

  /** Pesos efetivos depois da redistribuição. */
  weights: {
    imdb: number;
    rottenTomatoes: number;
    metacritic: number;
    tmdb: number;
  };
};

const BASE_WEIGHTS = {
  imdb: 0.4,
  rottenTomatoes: 0.3,
  metacritic: 0.2,
  tmdb: 0.1,
} as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp0To10(value: number): number {
  if (value < 0) return 0;
  if (value > 10) return 10;
  return value;
}

function normalizePercentTo10(value: number): number {
  return clamp0To10(value / 10);
}

/**
 * Calcula o POPLOG Score.
 *
 * Retorna null quando nenhuma fonte válida veio.
 */
export function computePoplogScore(
  input: PoplogScoreInput
): PoplogScoreBreakdown | null {
  const components: Array<{
    key: keyof typeof BASE_WEIGHTS;
    value: number;
    weight: number;
  }> = [];

  if (isFiniteNumber(input.imdb)) {
    components.push({
      key: "imdb",
      value: clamp0To10(input.imdb),
      weight: BASE_WEIGHTS.imdb,
    });
  }

  if (isFiniteNumber(input.rottenTomatoes)) {
    components.push({
      key: "rottenTomatoes",
      value: normalizePercentTo10(input.rottenTomatoes),
      weight: BASE_WEIGHTS.rottenTomatoes,
    });
  }

  if (isFiniteNumber(input.metacritic)) {
    components.push({
      key: "metacritic",
      value: normalizePercentTo10(input.metacritic),
      weight: BASE_WEIGHTS.metacritic,
    });
  }

  if (isFiniteNumber(input.tmdb)) {
    components.push({
      key: "tmdb",
      value: clamp0To10(input.tmdb),
      weight: BASE_WEIGHTS.tmdb,
    });
  }

  if (components.length === 0) {
    return null;
  }

  const totalWeight = components.reduce(
    (acc, component) => acc + component.weight,
    0
  );

  const weightedSum = components.reduce(
    (acc, component) =>
      acc + component.value * (component.weight / totalWeight),
    0
  );

  const score = Math.round(weightedSum * 10) / 10;

  const weights: PoplogScoreBreakdown["weights"] = {
    imdb: 0,
    rottenTomatoes: 0,
    metacritic: 0,
    tmdb: 0,
  };

  for (const component of components) {
    weights[component.key] = Number(
      ((component.weight / totalWeight) * 100).toFixed(1)
    );
  }

  return {
    score,
    componentsUsed: components.length,
    weights,
  };
}
import type { ContentCategory } from "./categories";
import {
  computeGlobalEditorialScore,
  formatScoreSignals,
  type RadarCompanySignal,
  type RadarScoreSignal,
} from "./editorial-signals";

export type RealityClassificationInput = {
  title: string;
  overview?: string | null;
  category: ContentCategory;
  genreIds?: number[] | null;
  tmdbType?: string | null;
  eventDate?: string | null;
  episodeCount?: number | null;
  spanDays?: number | null;
  popularity?: number | null;
  voteAverage?: number | null;
  voteCount?: number | null;
  originalLanguage?: string | null;
  originCountry?: string[] | null;
  backdropPath?: string | null;
  posterPath?: string | null;
  networks?: RadarCompanySignal[] | null;
  productionCompanies?: RadarCompanySignal[] | null;
  watchProviders?: RadarCompanySignal[] | null;
};

export type RealityClassificationResult = {
  category: ContentCategory;
  score: number;
  signals: RadarScoreSignal[];
  reason: string;
  blocked: boolean;
};

const REALITY_GENRE_ID = 10764;
const TALK_GENRE_ID = 10767;
const NEWS_GENRE_ID = 10763;
const SOAP_GENRE_ID = 10766;

const FORMAT_PATTERNS: Array<[RegExp, number, string]> = [
  [/\bcompetition|contest|challenge|talent|performance|drag|cooking|baking\b/i, 22, "format:competition_performance"],
  [/\bsurvival|strategy|game|elimination|winner|contestants|judges\b/i, 20, "format:strategy_game"],
  [/\bdating|social experiment|confinement|makeover|fashion|design|race\b/i, 16, "format:structured_reality"],
  [/\bcompetição|competidores|participantes|jurad|desafio|eliminação|vencedor|prova\b/i, 20, "format:competition_pt"],
  [/\bculinária|cozinha|confinamento|relacionamento|sobrevivência|performance\b/i, 16, "format:structured_pt"],
];

function add(signals: RadarScoreSignal[], key: string, value: number) {
  if (value <= 0) return;
  signals.push({ key, value });
}

function isRealityish(input: RealityClassificationInput): boolean {
  return (
    input.category === "REALITY" ||
    input.category === "REALITY_PREMIUM" ||
    input.tmdbType === "Reality" ||
    (input.genreIds ?? []).includes(REALITY_GENRE_ID)
  );
}

function hasStructuralBlock(input: RealityClassificationInput): string | null {
  const genreIds = input.genreIds ?? [];
  if (input.tmdbType === "Talk Show" || genreIds.includes(TALK_GENRE_ID)) return "talk_show_or_late_show";
  if (input.tmdbType === "News" || genreIds.includes(NEWS_GENRE_ID)) return "news";
  if (input.tmdbType === "Soap" || genreIds.includes(SOAP_GENRE_ID)) return "daily_soap";
  if (input.category === "VARIETY") return "variety_or_daily_show";
  if (input.category === "PODCAST") return "podcast";
  if (input.category === "SPORTS") return "sports";
  if (input.category === "LIVE_EVENT") return "live_event";
  return null;
}

function cadenceSignal(input: RealityClassificationInput): RadarScoreSignal {
  const episodes = input.episodeCount ?? 0;
  const span = input.spanDays ?? 0;
  if (episodes <= 1 || span <= 0) return { key: "cadence:single_or_unknown", value: 8 };

  const perDay = episodes / Math.max(1, span);
  if (perDay > 0.8) return { key: "cadence:daily_penalty", value: -25 };
  if (perDay > 0.35) return { key: "cadence:high_frequency_penalty", value: -12 };
  return { key: "cadence:weekly", value: 15 };
}

export function classifyRealityBySignals(
  input: RealityClassificationInput,
  threshold = 60,
): RealityClassificationResult {
  const blockReason = hasStructuralBlock(input);
  if (blockReason) {
    return {
      category: input.category,
      score: 0,
      signals: [{ key: `block:${blockReason}`, value: 0 }],
      reason: blockReason,
      blocked: true,
    };
  }

  if (!isRealityish(input)) {
    return {
      category: input.category,
      score: 0,
      signals: [],
      reason: "not_reality",
      blocked: false,
    };
  }

  const signals: RadarScoreSignal[] = [];
  add(signals, "genre:reality", 20);
  if (input.eventDate) add(signals, "event:dated", 20);

  const cadence = cadenceSignal(input);
  signals.push(cadence);

  if ((input.spanDays ?? 0) >= 14 || (input.episodeCount ?? 0) >= 3) {
    add(signals, "season_arc", 10);
  }

  const text = `${input.overview ?? ""}`;
  let bestFormat: RadarScoreSignal | null = null;
  for (const [pattern, value, key] of FORMAT_PATTERNS) {
    if (!pattern.test(text)) continue;
    if (!bestFormat || value > bestFormat.value) bestFormat = { key, value };
  }
  if (bestFormat) signals.push(bestFormat);

  const globalSignals = computeGlobalEditorialScore({
    title: input.title,
    mediaType: "tv",
    eventDate: input.eventDate,
    popularity: input.popularity,
    voteAverage: input.voteAverage,
    voteCount: input.voteCount,
    originalLanguage: input.originalLanguage,
    originCountry: input.originCountry,
    backdropPath: input.backdropPath,
    posterPath: input.posterPath,
    networks: input.networks,
    productionCompanies: input.productionCompanies,
    watchProviders: input.watchProviders,
  }).signals.filter(
    (signal) =>
      signal.key.startsWith("network:") ||
      signal.key.startsWith("studio:") ||
      signal.key.startsWith("platform:") ||
      signal.key === "image" ||
      signal.key.startsWith("vote_count") ||
      signal.key === "origin:br_pt",
  );

  signals.push(...globalSignals);

  const score = signals.reduce((sum, signal) => sum + signal.value, 0);
  const category: ContentCategory = score >= threshold ? "REALITY_PREMIUM" : "REALITY";
  const reason =
    category === "REALITY_PREMIUM"
      ? bestFormat
        ? "reality_format_event_relevant"
        : "reality_distribution_event_relevant"
      : cadence.value < 0
        ? "high_frequency_reality_reduced"
        : "reality_signals_below_threshold";

  return {
    category,
    score,
    signals,
    reason,
    blocked: false,
  };
}

export function formatRealitySignals(result: RealityClassificationResult): string {
  return formatScoreSignals(result.signals);
}

import type { FeedbackType, UserTitleFeedback } from "@/lib/personalization/feedback";

export type EditorialSurface =
  | "hero"
  | "for_you"
  | "radar"
  | "acompanhando"
  | "trending"
  | "search"
  | "title_page"
  | "library"
  | "contextual";

export type EditorialSurfaceInput = EditorialSurface | "agenda";

export type LegacyTitleSignals = {
  favorite?: boolean | null;
  liked?: boolean | null;
  status?: string | null;
};

export type EditorialPolicyInput = {
  feedback?: Array<Pick<UserTitleFeedback, "feedback_type" | "weight" | "updated_at" | "active">>;
  legacy?: LegacyTitleSignals | null;
  rating?: number | null;
  surface?: EditorialSurfaceInput;
  now?: Date;
};

export type EditorialSignalState = {
  favorite: boolean;
  liked: boolean;
  disliked: boolean;
  notInterested: boolean;
  hidden: boolean;
  boosted: boolean;
  dismissed: boolean;
  protectedByLibrary: boolean;
  ratingWeight: number;
  activeFeedbackTypes: FeedbackType[];
  neutralizedFeedbackTypes: FeedbackType[];
};

export type EditorialPolicyResult = {
  surface: EditorialSurface;
  state: EditorialSignalState;
  baseScore: number;
  surfaceMultiplier: number;
  surfaceScore: number;
  persistenceScore: number;
  decayResistance: number;
  shouldExclude: boolean;
  explanation: string[];
};

export const EDITORIAL_SIGNAL_WEIGHTS: Record<FeedbackType | "favorite", number> = {
  favorite: 100,
  liked: 35,
  boosted: 20,
  dismissed_from_section: -25,
  disliked: -45,
  not_interested: -70,
  hidden: -1000,
};

export const EDITORIAL_RATING_WEIGHTS = {
  high: 35,
  neutral: 0,
  low: -45,
} as const;

export const EDITORIAL_SURFACE_MULTIPLIERS: Record<EditorialSurface, number> = {
  hero: 1.6,
  for_you: 1.35,
  radar: 1.2,
  acompanhando: 1,
  trending: 0.7,
  search: 0.25,
  title_page: 0.1,
  library: 0,
  contextual: 0.8,
};

export const EDITORIAL_PERSISTENCE_WEIGHTS = {
  favorite: 100,
  liked: 40,
  protectedLibrary: 28,
  neutral: 0,
  negative: -24,
} as const;

const POSITIVE_LIBRARY_STATUSES = new Set(["watchlist", "watching", "watched"]);

export function normalizeEditorialSurface(
  surface: EditorialSurfaceInput | null | undefined,
): EditorialSurface {
  if (surface === "agenda") return "radar";
  return surface ?? "contextual";
}

function collectFeedbackTypes(
  feedback: EditorialPolicyInput["feedback"],
): Set<FeedbackType> {
  return new Set(
    (feedback ?? [])
      .filter((entry) => entry.active !== false)
      .map((entry) => entry.feedback_type),
  );
}

function deriveSignalState(input: EditorialPolicyInput): EditorialSignalState {
  const feedbackTypes = collectFeedbackTypes(input.feedback);
  const legacy = input.legacy ?? {};
  const favorite = legacy.favorite === true;
  const liked = legacy.liked === true || feedbackTypes.has("liked");
  const disliked = legacy.liked === false || feedbackTypes.has("disliked");
  const protectedByLibrary =
    favorite || POSITIVE_LIBRARY_STATUSES.has(String(legacy.status ?? ""));
  const ratingWeight = scoreRatingSignal(input.rating);

  const neutralizedFeedbackTypes: FeedbackType[] = [];
  let notInterested = feedbackTypes.has("not_interested");
  const hidden = feedbackTypes.has("hidden");
  let dismissed = feedbackTypes.has("dismissed_from_section");

  if (favorite) {
    for (const type of ["not_interested", "disliked", "dismissed_from_section"] as const) {
      if (feedbackTypes.has(type)) neutralizedFeedbackTypes.push(type);
    }
    notInterested = false;
    dismissed = false;
  } else if (liked || protectedByLibrary) {
    for (const type of ["not_interested", "dismissed_from_section"] as const) {
      if (feedbackTypes.has(type)) neutralizedFeedbackTypes.push(type);
    }
    notInterested = false;
    dismissed = false;
  }

  if (liked && disliked) {
    neutralizedFeedbackTypes.push("disliked");
  }

  return {
    favorite,
    liked,
    disliked: liked ? false : disliked,
    notInterested,
    hidden,
    boosted: feedbackTypes.has("boosted"),
    dismissed,
    protectedByLibrary,
    ratingWeight,
    activeFeedbackTypes: [...feedbackTypes],
    neutralizedFeedbackTypes: [...new Set(neutralizedFeedbackTypes)],
  };
}

function scoreRatingSignal(rating: number | null | undefined): number {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return EDITORIAL_RATING_WEIGHTS.neutral;
  if (rating >= 4) return EDITORIAL_RATING_WEIGHTS.high;
  if (rating <= 2.5) return EDITORIAL_RATING_WEIGHTS.low;
  return EDITORIAL_RATING_WEIGHTS.neutral;
}

function scoreSignals(state: EditorialSignalState): number {
  let score = 0;

  if (state.favorite) score += EDITORIAL_SIGNAL_WEIGHTS.favorite;
  if (state.liked) score += EDITORIAL_SIGNAL_WEIGHTS.liked;
  score += state.ratingWeight;

  if (state.boosted) score += EDITORIAL_SIGNAL_WEIGHTS.boosted;
  if (state.dismissed) score += EDITORIAL_SIGNAL_WEIGHTS.dismissed_from_section;
  if (state.notInterested) score += EDITORIAL_SIGNAL_WEIGHTS.not_interested;
  if (state.disliked) score += EDITORIAL_SIGNAL_WEIGHTS.disliked;
  if (state.hidden) score += EDITORIAL_SIGNAL_WEIGHTS.hidden;

  return score;
}

function buildExplanation(state: EditorialSignalState): string[] {
  const explanation: string[] = [];

  if (state.favorite) explanation.push("favorite_priority");
  if (state.liked) explanation.push("liked_boost");
  if (state.ratingWeight > 0) explanation.push("high_rating_boost");
  if (state.ratingWeight < 0) explanation.push("low_rating_penalty");

  if (state.boosted) explanation.push("contextual_boost");
  if (state.dismissed) explanation.push("contextual_dismissal");
  if (state.notInterested) explanation.push("not_interested_penalty");
  if (state.disliked) explanation.push("disliked_penalty");
  if (state.hidden) explanation.push("hidden_exclusion");
  if (state.protectedByLibrary) explanation.push("library_state_protection");

  for (const type of state.neutralizedFeedbackTypes) {
    explanation.push(`neutralized_${type}`);
  }

  return explanation;
}

function computePersistenceScore(state: EditorialSignalState): number {
  if (state.favorite) return EDITORIAL_PERSISTENCE_WEIGHTS.favorite;
  if (state.liked) return EDITORIAL_PERSISTENCE_WEIGHTS.liked;
  if (state.protectedByLibrary) return EDITORIAL_PERSISTENCE_WEIGHTS.protectedLibrary;
  if (state.hidden || state.notInterested || state.disliked) {
    return EDITORIAL_PERSISTENCE_WEIGHTS.negative;
  }
  return EDITORIAL_PERSISTENCE_WEIGHTS.neutral;
}

function computeDecayResistance(state: EditorialSignalState): number {
  if (state.favorite) return 1;
  if (state.liked) return 0.65;
  if (state.protectedByLibrary) return 0.5;
  if (state.hidden || state.notInterested || state.disliked) return 0.15;
  return 0.3;
}

export function resolveEditorialPolicy(input: EditorialPolicyInput): EditorialPolicyResult {
  const surface = normalizeEditorialSurface(input.surface);
  const state = deriveSignalState(input);
  const baseScore = scoreSignals(state);
  const surfaceMultiplier = EDITORIAL_SURFACE_MULTIPLIERS[surface];
  const surfaceScore = Math.round(baseScore * surfaceMultiplier);
  const shouldExclude =
    (state.hidden || state.notInterested) &&
    surface !== "search" &&
    surface !== "title_page" &&
    surface !== "library";

  return {
    surface,
    state,
    baseScore,
    surfaceMultiplier,
    surfaceScore,
    persistenceScore: computePersistenceScore(state),
    decayResistance: computeDecayResistance(state),
    shouldExclude,
    explanation: buildExplanation(state),
  };
}

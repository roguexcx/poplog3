import {
  feedbackKey,
  getTitleFeedbackState,
  type UserFeedbackMap,
} from "@/lib/personalization/feedback";
import {
  resolveEditorialPolicy,
  type EditorialSurfaceInput,
  type LegacyTitleSignals,
} from "@/lib/personalization/editorial-policy";
import type { MediaType } from "@/types/user";

export type FeedbackScoringContext =
  | "home"
  | "for_you"
  | "discovery"
  | "oracle"
  | "search"
  | "contextual"
  | "trending"
  | "library";

export type ScorableTitle = {
  id: number;
  media_type?: MediaType | string;
  popularity?: number | null;
  vote_average?: number | null;
  vote_count?: number | null;
  personalScore?: number;
  feedbackPenaltyApplied?: number;
  editorialScoreApplied?: number;
  editorialShouldExclude?: boolean;
  userFeedback?: {
    notInterested?: boolean;
    activeTypes?: string[];
  };
};

export type UserRatingSignalMap = Map<string, number>;
export type LegacyTitleSignalMap = Map<string, LegacyTitleSignals>;

export type FeedbackScoringOptions<T extends ScorableTitle> = {
  userId?: string | null;
  feedbackMap?: UserFeedbackMap;
  ratingMap?: UserRatingSignalMap;
  legacySignalMap?: LegacyTitleSignalMap;
  context: FeedbackScoringContext;
  mediaType?: MediaType;
  getBaseScore?: (item: T, index: number) => number;
  preserveOrder?: boolean;
};

const CONTEXT_TO_SURFACE: Record<FeedbackScoringContext, EditorialSurfaceInput> = {
  home: "for_you",
  for_you: "for_you",
  discovery: "radar",
  oracle: "contextual",
  search: "search",
  contextual: "contextual",
  trending: "trending",
  library: "library",
};

function resolveMediaType(item: ScorableTitle, fallback?: MediaType): MediaType | null {
  if (item.media_type === "movie" || item.media_type === "tv") return item.media_type;
  return fallback ?? null;
}

export function scoreTitleForUser<T extends ScorableTitle>(
  item: T,
  index: number,
  options: FeedbackScoringOptions<T>,
): T {
  const baseScore = options.getBaseScore?.(item, index) ?? item.personalScore ?? (10_000 - index);
  const mediaType = resolveMediaType(item, options.mediaType);

  if (!options.userId || !mediaType) {
    return { ...item, personalScore: baseScore, feedbackPenaltyApplied: 0 };
  }

  const feedback = getTitleFeedbackState(options.feedbackMap, item.id, mediaType);
  const key = feedbackKey(item.id, mediaType);
  const rows = options.feedbackMap?.get(key) ?? [];
  const policy = resolveEditorialPolicy({
    feedback: rows.map((row) => ({
      feedback_type: row.feedback_type,
      weight: row.weight,
      updated_at: row.updated_at,
      active: row.active,
    })),
    legacy: options.legacySignalMap?.get(key) ?? null,
    rating: options.ratingMap?.get(key) ?? null,
    surface: CONTEXT_TO_SURFACE[options.context],
  });

  return {
    ...item,
    personalScore: baseScore + policy.surfaceScore,
    feedbackPenaltyApplied: policy.surfaceScore < 0 ? Math.abs(policy.surfaceScore) : 0,
    editorialScoreApplied: policy.surfaceScore,
    editorialShouldExclude: policy.shouldExclude,
    userFeedback: {
      ...(item.userFeedback ?? {}),
      notInterested: feedback.notInterested,
      activeTypes: feedback.activeFeedbackTypes,
    },
  };
}

export function applyUserFeedbackScoring<T extends ScorableTitle>(
  items: T[],
  options: FeedbackScoringOptions<T>,
): T[] {
  const scored = items.map((item, index) => scoreTitleForUser(item, index, options));
  if (options.preserveOrder || options.context === "search" || options.context === "library") return scored;
  return scored.sort((a, b) => (b.personalScore ?? 0) - (a.personalScore ?? 0));
}

export const applyUserFeedbackRanking = applyUserFeedbackScoring;

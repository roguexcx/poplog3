import {
  feedbackKey,
  getTitleFeedbackState,
  type UserFeedbackMap,
} from "@/lib/personalization/feedback";
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
  userFeedback?: {
    notInterested?: boolean;
    activeTypes?: string[];
  };
};

export type FeedbackScoringOptions<T extends ScorableTitle> = {
  userId?: string | null;
  feedbackMap?: UserFeedbackMap;
  context: FeedbackScoringContext;
  mediaType?: MediaType;
  getBaseScore?: (item: T, index: number) => number;
  preserveOrder?: boolean;
};

const CONTEXT_PENALTY: Record<FeedbackScoringContext, number> = {
  home: 90,
  for_you: 100,
  discovery: 58,
  oracle: 140,
  search: 0,
  contextual: 32,
  trending: 52,
  library: 0,
};

function resolveMediaType(item: ScorableTitle, fallback?: MediaType): MediaType | null {
  if (item.media_type === "movie" || item.media_type === "tv") return item.media_type;
  return fallback ?? null;
}

function contextualReappearanceCredit(item: ScorableTitle, context: FeedbackScoringContext): number {
  if (context === "search" || context === "library") return CONTEXT_PENALTY[context];
  if (context === "contextual") return 22;

  const popularity = item.popularity ?? 0;
  const rating = item.vote_average ?? 0;
  const votes = item.vote_count ?? 0;

  if (popularity >= 450) return 42;
  if (popularity >= 220) return 26;
  if (rating >= 8.2 && votes >= 1800) return 24;
  if (rating >= 7.6 && votes >= 3500) return 18;
  return 0;
}

export function scoreTitleForUser<T extends ScorableTitle>(
  item: T,
  index: number,
  options: FeedbackScoringOptions<T>,
): T {
  const baseScore = options.getBaseScore?.(item, index) ?? item.personalScore ?? (10_000 - index);
  const mediaType = resolveMediaType(item, options.mediaType);

  if (!options.userId || !mediaType || !options.feedbackMap) {
    return { ...item, personalScore: baseScore, feedbackPenaltyApplied: 0 };
  }

  const feedback = getTitleFeedbackState(options.feedbackMap, item.id, mediaType);
  const rows = options.feedbackMap.get(feedbackKey(item.id, mediaType)) ?? [];
  const negativeWeight = rows
    .filter((row) => row.feedback_type === "not_interested")
    .reduce((total, row) => total + Math.min(row.weight, 0), 0);

  const rawPenalty = Math.abs(negativeWeight) * CONTEXT_PENALTY[options.context];
  const reappearanceCredit = feedback.notInterested
    ? contextualReappearanceCredit(item, options.context)
    : 0;
  const penalty = Math.max(0, rawPenalty - reappearanceCredit);

  return {
    ...item,
    personalScore: baseScore - penalty,
    feedbackPenaltyApplied: penalty,
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

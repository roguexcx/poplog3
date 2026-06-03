import type { MediaType } from "@/types/user";

export const FEEDBACK_TYPES = [
  "not_interested",
  "liked",
  "disliked",
  "hidden",
  "boosted",
  "dismissed_from_section",
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export type UserTitleFeedback = {
  id: string;
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  feedback_type: FeedbackType;
  weight: number;
  reason: string | null;
  source: string | null;
  // Fields added by feedback engine migration (20260522000100)
  active: boolean;
  scope: string;
  surface: string | null;
  section_key: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  strength: number | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
};

export type UserFeedbackMap = Map<string, UserTitleFeedback[]>;

export type TitleFeedbackState = {
  notInterested: boolean;
  activeFeedbackTypes: FeedbackType[];
  latestFeedback?: UserTitleFeedback;
};

async function getLocalFeedbackService() {
  return import("@/server/local-services/feedback-local.service");
}

export function feedbackKey(tmdbId: number, mediaType: MediaType): string {
  return `${mediaType}:${tmdbId}`;
}

export function isFeedbackType(value: unknown): value is FeedbackType {
  return typeof value === "string" && (FEEDBACK_TYPES as readonly string[]).includes(value);
}

export function isMediaType(value: unknown): value is MediaType {
  return value === "movie" || value === "tv";
}

export function normalizeFeedbackWeight(type: FeedbackType, weight?: number): number {
  if (typeof weight === "number" && Number.isFinite(weight)) return weight;
  if (type === "not_interested") return -1;
  if (type === "disliked" || type === "hidden") return -2;
  if (type === "boosted" || type === "liked") return 1;
  return -0.5;
}

export function getTitleFeedbackState(
  feedbackMap: UserFeedbackMap | null | undefined,
  tmdbId: number,
  mediaType: MediaType,
): TitleFeedbackState {
  const entries = feedbackMap?.get(feedbackKey(tmdbId, mediaType)) ?? [];
  // Only consider rows where active !== false (handles both true and legacy rows without the column)
  const activeEntries = entries.filter((entry) => entry.active !== false);
  const activeFeedbackTypes = activeEntries.map((entry) => entry.feedback_type);

  return {
    notInterested: activeFeedbackTypes.includes("not_interested"),
    activeFeedbackTypes,
    latestFeedback: activeEntries[0],
  };
}

export async function getUserFeedbackMap(
  userId: string | null | undefined,
): Promise<UserFeedbackMap> {
  const map: UserFeedbackMap = new Map();
  if (!userId) return map;
  const local = await getLocalFeedbackService();
  return local.getUserFeedbackMap(userId);
}

export async function removeNegativeFeedbackForTitle(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
) {
  const local = await getLocalFeedbackService();
  return local.removeNegativeFeedbackForTitle(userId, tmdbId, mediaType);
}

export async function getTitleFeedbackMap(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<UserFeedbackMap> {
  const local = await getLocalFeedbackService();
  return local.getTitleFeedbackMap(userId, tmdbId, mediaType);
}

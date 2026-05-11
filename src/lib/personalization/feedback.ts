import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  created_at: string;
  updated_at: string;
};

export type UserFeedbackMap = Map<string, UserTitleFeedback[]>;

export type TitleFeedbackState = {
  notInterested: boolean;
  activeFeedbackTypes: FeedbackType[];
  latestFeedback?: UserTitleFeedback;
};

type SupabaseLike = Awaited<ReturnType<typeof createSupabaseServerClient>>;

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
  const activeFeedbackTypes = entries.map((entry) => entry.feedback_type);

  return {
    notInterested: activeFeedbackTypes.includes("not_interested"),
    activeFeedbackTypes,
    latestFeedback: entries[0],
  };
}

export async function getUserFeedbackMap(
  userId: string | null | undefined,
  supabase?: SupabaseLike,
): Promise<UserFeedbackMap> {
  const map: UserFeedbackMap = new Map();
  if (!userId) return map;

  const client = supabase ?? await createSupabaseServerClient();
  const { data, error } = await client
    .from("user_title_feedback")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Erro ao carregar feedbacks do usuário:", error);
    return map;
  }

  for (const row of (data ?? []) as UserTitleFeedback[]) {
    const key = feedbackKey(row.tmdb_id, row.media_type);
    const current = map.get(key) ?? [];
    current.push(row);
    map.set(key, current);
  }

  return map;
}

export async function removeNegativeFeedbackForTitle(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
  supabase?: SupabaseLike,
) {
  const client = supabase ?? await createSupabaseServerClient();
  await client
    .from("user_title_feedback")
    .delete()
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .in("feedback_type", ["not_interested", "disliked", "hidden"]);
}

export async function getTitleFeedbackMap(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
  supabase?: SupabaseLike,
): Promise<UserFeedbackMap> {
  const client = supabase ?? await createSupabaseServerClient();
  const { data } = await client
    .from("user_title_feedback")
    .select("*")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType);

  const map: UserFeedbackMap = new Map();
  if (data?.length) map.set(feedbackKey(tmdbId, mediaType), data as UserTitleFeedback[]);
  return map;
}

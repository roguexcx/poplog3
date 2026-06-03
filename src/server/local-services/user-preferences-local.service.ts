import type { UserCuradoriaPreference } from "@prisma/client";
import {
  getUserCuradoriaPreference,
  upsertUserCuradoriaPreference,
  type UpsertUserCuradoriaPreferenceInput,
} from "@/server/repositories";

export type UserCuradoriaPreferenceLocal = {
  user_id: string;
  preferred_session_duration_minutes: number;
  typical_watch_days: unknown;
  typical_watch_time_start: number | null;
  typical_watch_time_end: number | null;
  top_genres: unknown;
  top_platforms: unknown;
  avg_episodes_per_session: number | null;
  prefers_short_content: boolean;
  binge_tendency_score: number;
  updated_at: string;
};

function mapPreference(row: UserCuradoriaPreference): UserCuradoriaPreferenceLocal {
  return {
    user_id: row.userId,
    preferred_session_duration_minutes: row.preferredSessionDurationMinutes,
    typical_watch_days: row.typicalWatchDays,
    typical_watch_time_start: row.typicalWatchTimeStart,
    typical_watch_time_end: row.typicalWatchTimeEnd,
    top_genres: row.topGenres,
    top_platforms: row.topPlatforms,
    avg_episodes_per_session: row.avgEpisodesPerSession === null ? null : Number(row.avgEpisodesPerSession),
    prefers_short_content: row.prefersShortContent,
    binge_tendency_score: Number(row.bingeTendencyScore),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function getUserPreferences(userId: string): Promise<UserCuradoriaPreferenceLocal | null> {
  const result = await getUserCuradoriaPreference(userId);
  if (!result.ok) throw new Error(result.error);
  return result.data ? mapPreference(result.data) : null;
}

export async function upsertUserPreferences(
  input: UpsertUserCuradoriaPreferenceInput,
): Promise<UserCuradoriaPreferenceLocal> {
  const result = await upsertUserCuradoriaPreference(input);
  if (!result.ok) throw new Error(result.error);
  return mapPreference(result.data);
}

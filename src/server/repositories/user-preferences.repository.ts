import { db } from "@/server/db/client";
import type { UserCuradoriaPreference } from "@prisma/client";
import type { RepositoryResult } from "./types";

export type UpsertUserCuradoriaPreferenceInput = {
  userId: string;
  preferredSessionDurationMinutes?: number;
  typicalWatchDays?: unknown;
  typicalWatchTimeStart?: number | null;
  typicalWatchTimeEnd?: number | null;
  topGenres?: unknown;
  topPlatforms?: unknown;
  avgEpisodesPerSession?: number | null;
  prefersShortContent?: boolean;
  bingeTendencyScore?: number;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function getUserCuradoriaPreference(
  userId: string,
): Promise<RepositoryResult<UserCuradoriaPreference | null>> {
  try {
    const row = await db.userCuradoriaPreference.findUnique({ where: { userId } });
    return { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function upsertUserCuradoriaPreference(
  input: UpsertUserCuradoriaPreferenceInput,
): Promise<RepositoryResult<UserCuradoriaPreference>> {
  try {
    const data = {
      preferredSessionDurationMinutes: input.preferredSessionDurationMinutes ?? 60,
      typicalWatchDays: input.typicalWatchDays as object ?? undefined,
      typicalWatchTimeStart: input.typicalWatchTimeStart ?? null,
      typicalWatchTimeEnd: input.typicalWatchTimeEnd ?? null,
      topGenres: input.topGenres as object ?? undefined,
      topPlatforms: input.topPlatforms as object ?? undefined,
      avgEpisodesPerSession: input.avgEpisodesPerSession ?? null,
      prefersShortContent: input.prefersShortContent ?? false,
      bingeTendencyScore: input.bingeTendencyScore ?? 0.5,
    };
    const row = await db.userCuradoriaPreference.upsert({
      where: { userId: input.userId },
      update: data,
      create: {
        userId: input.userId,
        ...data,
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

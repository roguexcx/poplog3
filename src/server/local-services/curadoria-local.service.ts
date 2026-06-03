import {
  createCuradoriaSignal,
  createUserEvent,
  deleteCuradoriaSignalsForContent,
  listCuradoriaSignals,
} from "@/server/repositories";
import type { MediaType, UserCuradoriaSignal, UserCuradoriaSignalType } from "@prisma/client";

export type CuradoriaSignalType = UserCuradoriaSignalType;

export type CuradoriaSignalRow = {
  id: string;
  user_id: string;
  content_id: string;
  signal_type: UserCuradoriaSignalType;
  signal_value: unknown;
  created_at: string;
};

function mapSignal(row: UserCuradoriaSignal): CuradoriaSignalRow {
  return {
    id: row.id,
    user_id: row.userId,
    content_id: row.contentId,
    signal_type: row.signalType,
    signal_value: row.signalValue,
    created_at: row.createdAt.toISOString(),
  };
}

export function toContentId(mediaType: MediaType, tmdbId: number): string {
  return `tmdb-${mediaType}-${tmdbId}`;
}

export async function logCuradoriaSignal(
  userId: string,
  contentId: string,
  signalType: UserCuradoriaSignalType,
  signalValue?: Record<string, unknown> | null,
): Promise<CuradoriaSignalRow> {
  const result = await createCuradoriaSignal({
    userId,
    contentId,
    signalType,
    signalValue: signalValue ?? null,
  });
  if (!result.ok) throw new Error(result.error);
  return mapSignal(result.data);
}

export async function getCuradoriaSignals(input: {
  userId: string;
  contentId?: string;
  signalType?: UserCuradoriaSignalType;
  limit?: number;
}): Promise<CuradoriaSignalRow[]> {
  const result = await listCuradoriaSignals(input);
  if (!result.ok) throw new Error(result.error);
  return result.data.map(mapSignal);
}

export async function clearCuradoriaSignals(input: {
  userId: string;
  contentId: string;
  signalType?: UserCuradoriaSignalType;
}): Promise<number> {
  const result = await deleteCuradoriaSignalsForContent(input);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export async function logUserActionEvent(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  eventType: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await createUserEvent(input);
}

import { db } from "@/server/db/client";
import type { MediaType, UserEvent } from "@prisma/client";
import type { RepositoryResult, RepositoryVoidResult } from "./types";

export type CreateUserEventInput = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  eventType: string;
  payload?: Record<string, unknown>;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function createUserEvent(
  input: CreateUserEventInput,
): Promise<RepositoryResult<UserEvent>> {
  try {
    const row = await db.userEvent.create({
      data: {
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        eventType: input.eventType,
        payload: input.payload ?? {},
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    console.warn("[user-events.repository] write failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function listUserEvents(input: {
  userId: string;
  tmdbId?: number;
  mediaType?: MediaType;
  eventType?: string;
  limit?: number;
}): Promise<RepositoryResult<UserEvent[]>> {
  try {
    const rows = await db.userEvent.findMany({
      where: {
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        eventType: input.eventType,
      },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 50,
    });
    return { ok: true, data: rows };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteUserEvent(id: string): Promise<RepositoryVoidResult> {
  try {
    await db.userEvent.delete({ where: { id } });
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteUserEventsForTitle(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  eventType?: string;
}): Promise<RepositoryResult<number>> {
  try {
    const result = await db.userEvent.deleteMany({
      where: {
        userId: input.userId,
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        eventType: input.eventType,
      },
    });
    return { ok: true, data: result.count };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

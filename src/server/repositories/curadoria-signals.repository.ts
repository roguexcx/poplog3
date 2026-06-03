import { db } from "@/server/db/client";
import type { UserCuradoriaSignal, UserCuradoriaSignalType } from "@prisma/client";
import type { RepositoryResult, RepositoryVoidResult } from "./types";

export type CreateCuradoriaSignalInput = {
  userId: string;
  contentId: string;
  signalType: UserCuradoriaSignalType;
  signalValue?: Record<string, unknown> | null;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function createCuradoriaSignal(
  input: CreateCuradoriaSignalInput,
): Promise<RepositoryResult<UserCuradoriaSignal>> {
  try {
    const row = await db.userCuradoriaSignal.create({
      data: {
        userId: input.userId,
        contentId: input.contentId,
        signalType: input.signalType,
        signalValue: input.signalValue ?? null,
      },
    });
    return { ok: true, data: row };
  } catch (error) {
    console.warn("[curadoria-signals.repository] write failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function listCuradoriaSignals(input: {
  userId: string;
  contentId?: string;
  signalType?: UserCuradoriaSignalType;
  limit?: number;
}): Promise<RepositoryResult<UserCuradoriaSignal[]>> {
  try {
    const rows = await db.userCuradoriaSignal.findMany({
      where: {
        userId: input.userId,
        contentId: input.contentId,
        signalType: input.signalType,
      },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 50,
    });
    return { ok: true, data: rows };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteCuradoriaSignal(id: string): Promise<RepositoryVoidResult> {
  try {
    await db.userCuradoriaSignal.delete({ where: { id } });
    return { ok: true, data: null };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteCuradoriaSignalsForContent(input: {
  userId: string;
  contentId: string;
  signalType?: UserCuradoriaSignalType;
}): Promise<RepositoryResult<number>> {
  try {
    const result = await db.userCuradoriaSignal.deleteMany({
      where: {
        userId: input.userId,
        contentId: input.contentId,
        signalType: input.signalType,
      },
    });
    return { ok: true, data: result.count };
  } catch (error) {
    return { ok: false, error: messageFromError(error) };
  }
}

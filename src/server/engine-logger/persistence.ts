import type { EngineLogEntry, EngineStats } from "./types";
import { compactError, logger } from "@/server/logging/logger";

let persistWarningMutedUntil = 0;

type PersistentSnapshot = {
  stats: EngineStats;
  entries: EngineLogEntry[];
  source: "persistent";
};

export async function persistEngineLogEntry(entry: EngineLogEntry): Promise<void> {
  try {
    const local = await import("@/server/local-services/engine-logger-local.service");
    await local.persistEngineLogEntry(entry);
  } catch (err) {
    warnPersistOnce("[engine-logger] Local persistence failed:", err);
  }
}

function warnPersistOnce(message: string, detail: unknown): void {
  const now = Date.now();
  if (now < persistWarningMutedUntil) return;
  persistWarningMutedUntil = now + 60_000;
  logger.warn(`${message} ${compactError(detail)}`);
}

export async function getPersistentSnapshot(limit: number): Promise<PersistentSnapshot | null> {
  try {
    const local = await import("@/server/local-services/engine-logger-local.service");
    const snapshot = await local.getPersistentSnapshot(limit);
    if (snapshot) return snapshot;
  } catch (err) {
    logger.warn(`[engine-logger] Local snapshot failed: ${compactError(err)}`);
  }
  return null;
}

export async function clearPersistentEntries(): Promise<boolean> {
  try {
    const local = await import("@/server/local-services/engine-logger-local.service");
    return await local.clearPersistentEntries();
  } catch (err) {
    logger.warn(`[engine-logger] Limpeza persistente indisponível: ${compactError(err)}`);
    return false;
  }
}

import type { ApiName, EngineLogEntry, EngineStats } from "./types";

const API_NAMES: ApiName[] = ["tmdb", "omdb", "watchmode", "motn", "balloonerismm", "tvdb"];
const PERSISTENCE_WINDOW_HOURS = 24;
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
  console.warn(message, detail);
}

export async function getPersistentSnapshot(limit: number): Promise<PersistentSnapshot | null> {
  try {
    const local = await import("@/server/local-services/engine-logger-local.service");
    const snapshot = await local.getPersistentSnapshot(limit);
    if (snapshot) return snapshot;
  } catch (err) {
    console.warn("[engine-logger] Local snapshot failed:", err);
  }
  return null;
}

export async function clearPersistentEntries(): Promise<boolean> {
  try {
    const local = await import("@/server/local-services/engine-logger-local.service");
    return await local.clearPersistentEntries();
  } catch (err) {
    console.warn(
      "[engine-logger] Limpeza persistente indisponível:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}


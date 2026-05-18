import { push } from "./store";
import { getOrigin } from "./context";
import type { EngineLogEntry } from "./types";

export { withOrigin } from "./context";
export { getStats, getEntries, clear } from "./store";
export type { EngineLogEntry, EngineStats, ApiStats, Origin, ApiName, CacheStatus } from "./types";

type LogInput = Omit<EngineLogEntry, "id" | "ts" | "origin"> & {
  origin?: EngineLogEntry["origin"];
};

export function logApiCall(input: LogInput): void {
  push({
    ...input,
    ts: Date.now(),
    origin: input.origin ?? getOrigin(),
  });
}

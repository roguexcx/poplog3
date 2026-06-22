import type { ApiLogEntry } from "../types/api-log";

export function logApiEvent(entry: ApiLogEntry) {
  console.log(
    `[API:${entry.api}]`,
    JSON.stringify(entry, null, 2)
  );
}
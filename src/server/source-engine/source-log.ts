import { logger } from "@/server/logging/logger";

type LogValue = string | number | boolean | null | undefined;

function serializeValue(value: LogValue): string | null {
  if (value === undefined || value === null) return null;
  const raw = String(value);
  return /\s/.test(raw) ? JSON.stringify(raw) : raw;
}

export function sourceEngineLog(
  event: string,
  fields: Record<string, LogValue> = {},
  level: "info" | "warn" | "error" | "debug" = "info",
): void {
  const details = Object.entries(fields)
    .map(([key, value]) => {
      const serialized = serializeValue(value);
      return serialized === null ? null : `${key}=${serialized}`;
    })
    .filter((value): value is string => Boolean(value))
    .join(" ");

  logger[level](`[source-engine] ${event}${details ? ` ${details}` : ""}`);
}

export async function measureSourceEngine<T>(
  event: string,
  fields: Record<string, LogValue>,
  task: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await task();
    sourceEngineLog(event, { ...fields, duration: `${Date.now() - startedAt}ms` });
    return result;
  } catch (error) {
    sourceEngineLog(
      `${event}_failed`,
      {
        ...fields,
        duration: `${Date.now() - startedAt}ms`,
        error: error instanceof Error ? error.message : String(error),
      },
      "warn",
    );
    throw error;
  }
}


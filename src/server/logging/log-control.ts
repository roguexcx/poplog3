import { isEnvFlagEnabled, logger } from "./logger";

type LogLevel = "log" | "info" | "warn" | "error";

const onceKeys = new Set<string>();
const rateLimitedKeys = new Map<string, { lastLoggedAt: number; suppressed: number }>();

function write(level: LogLevel, message: string, payload?: unknown) {
  if (level === "log" || level === "info") {
    logger.info(message, payload);
    return;
  }
  if (level === "warn") {
    logger.warn(message, payload);
    return;
  }
  if (level === "error") {
    logger.error(message, payload);
  }
}

export function isDebugEnabled(flag: string) {
  return isEnvFlagEnabled(flag);
}

export function formatError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      message: typeof record.message === "string" ? record.message : String(error),
      code: typeof record.code === "string" ? record.code : undefined,
      details: typeof record.details === "string" ? record.details : undefined,
      hint: typeof record.hint === "string" ? record.hint : undefined,
      status: typeof record.status === "number" ? record.status : undefined,
    };
  }

  return { message: String(error) };
}

export function logOnce(
  key: string,
  message: string,
  payload?: unknown,
  level: LogLevel = "warn",
) {
  if (onceKeys.has(key)) return;
  onceKeys.add(key);
  write(level, message, payload);
}

export function rateLimitedLog(
  key: string,
  ttlMs: number,
  message: string,
  payload?: unknown,
  level: LogLevel = "warn",
) {
  const now = Date.now();
  const state = rateLimitedKeys.get(key);

  if (state && now - state.lastLoggedAt < ttlMs) {
    state.suppressed += 1;
    return;
  }

  const suppressed = state?.suppressed ?? 0;
  rateLimitedKeys.set(key, { lastLoggedAt: now, suppressed: 0 });

  const finalMessage =
    suppressed > 0
      ? `${message}\n- ${suppressed} ocorrências agrupadas desde o último log`
      : message;

  write(level, finalMessage, payload);
}

export function rateLimitedWarn(
  key: string,
  ttlMs: number,
  message: string,
  payload?: unknown,
) {
  rateLimitedLog(key, ttlMs, message, payload, "warn");
}

export function debugLog(flag: string, message: string, payload?: unknown) {
  if (!isDebugEnabled(flag)) return;
  write("log", message, payload);
}

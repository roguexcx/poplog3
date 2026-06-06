type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

function configuredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === "error" || raw === "warn" || raw === "info" || raw === "debug" || raw === "trace") {
    return raw;
  }
  return "info";
}

export function isLogLevelEnabled(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[configuredLevel()];
}

function write(level: LogLevel, message: string, payload?: unknown) {
  if (!isLogLevelEnabled(level)) return;

  const writer =
    level === "error" ? console.error :
    level === "warn" ? console.warn :
    console.log;

  if (payload === undefined) {
    writer(message);
    return;
  }

  writer(message, payload);
}

export const logger = {
  info: (message: string, payload?: unknown) => write("info", message, payload),
  warn: (message: string, payload?: unknown) => write("warn", message, payload),
  error: (message: string, payload?: unknown) => write("error", message, payload),
  debug: (message: string, payload?: unknown) => write("debug", message, payload),
  trace: (message: string, payload?: unknown) => write("trace", message, payload),
};

export function isEnvFlagEnabled(name: string): boolean {
  const value = process.env[name]?.toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

export function compactError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "0ms";
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}

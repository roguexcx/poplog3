import { formatDuration, logger } from "./logger";

type RouteLogInput = {
  method: string;
  path: string;
  status: number;
  startedAt: number;
  reason?: string;
  received?: string | number | null;
};

export function logRouteResult(input: RouteLogInput): void {
  const duration = formatDuration(Date.now() - input.startedAt);
  const base = `${input.method} ${input.path} | ${input.status}`;
  const detail = [
    input.reason ? `reason=${input.reason}` : null,
    input.received != null ? `received=${input.received}` : null,
    duration,
  ].filter(Boolean).join(" | ");

  if (input.status >= 500) {
    logger.error(`[ROUTE:ERROR] ${base}${detail ? ` | ${detail}` : ""}`);
    return;
  }

  if (input.status >= 400) {
    logger.warn(`[ROUTE:ERROR] ${base}${detail ? ` | ${detail}` : ""}`);
    return;
  }

  logger.debug(`[ROUTE] ${base} | ok | ${duration}`);
}

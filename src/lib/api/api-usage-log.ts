import { isStreamingDebugLogsEnabled } from "@/lib/env";

export type ExternalApiName = "tmdb" | "watchmode" | "movieofthenight";

type ApiUsageLogEntry = {
  apiName: ExternalApiName;
  endpoint: string;
  success: boolean;
  statusCode?: number;
  skippedReason?: string;
  errorMessage?: string;
};

export function logApiUsage(entry: ApiUsageLogEntry): void {
  if (!isStreamingDebugLogsEnabled()) return;

  const payload = {
    apiName: entry.apiName,
    endpoint: entry.endpoint,
    timestamp: new Date().toISOString(),
    success: entry.success,
    statusCode: entry.statusCode,
    skippedReason: entry.skippedReason,
    errorMessage: entry.errorMessage,
  };

  const method = entry.success ? console.info : console.warn;
  method("[api-usage]", payload);
}

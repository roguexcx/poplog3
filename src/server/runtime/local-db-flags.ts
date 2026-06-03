function readBooleanFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
}

export function isLocalDbEnabled(): boolean {
  return readBooleanFlag("POPLOG_LOCAL_DB_ENABLED");
}

export function isLocalLogsEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_LOGS_ENABLED");
}

export function isLocalCacheEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_CACHE_ENABLED");
}

export function isLocalApiUsageEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_API_USAGE_ENABLED");
}

export function getLocalDbFlagState() {
  return {
    localDb: isLocalDbEnabled(),
    logs: isLocalLogsEnabled(),
    cache: isLocalCacheEnabled(),
    apiUsage: isLocalApiUsageEnabled(),
  };
}

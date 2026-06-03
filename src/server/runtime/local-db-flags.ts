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

export function isLocalAvailabilityEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_AVAILABILITY_ENABLED");
}

export function isLocalLibraryEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_LIBRARY_ENABLED");
}

export function isLocalUserStateEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_USER_STATE_ENABLED");
}

export function isLocalEpisodeProgressEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_EPISODE_PROGRESS_ENABLED");
}

export function isLocalUserRatingsEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_USER_RATINGS_ENABLED");
}

export function isLocalFeedbackEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_FEEDBACK_ENABLED");
}

export function isLocalUserPreferencesEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_USER_PREFERENCES_ENABLED");
}

export function isLocalCuradoriaEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_CURADORIA_ENABLED");
}

export function isLocalCuradoriaStateEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_CURADORIA_STATE_ENABLED");
}

export function isLocalAcompanhandoEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_ACOMPANHANDO_ENABLED");
}

export function isLocalHeroEnabled(): boolean {
  return isLocalDbEnabled() || readBooleanFlag("POPLOG_LOCAL_HERO_ENABLED");
}

export function getLocalDbFlagState() {
  return {
    localDb: isLocalDbEnabled(),
    logs: isLocalLogsEnabled(),
    cache: isLocalCacheEnabled(),
    apiUsage: isLocalApiUsageEnabled(),
    availability: isLocalAvailabilityEnabled(),
    library: isLocalLibraryEnabled(),
    userState: isLocalUserStateEnabled(),
    episodeProgress: isLocalEpisodeProgressEnabled(),
    userRatings: isLocalUserRatingsEnabled(),
    feedback: isLocalFeedbackEnabled(),
    userPreferences: isLocalUserPreferencesEnabled(),
    curadoria: isLocalCuradoriaEnabled(),
    curadoriaState: isLocalCuradoriaStateEnabled(),
    acompanhando: isLocalAcompanhandoEnabled(),
    hero: isLocalHeroEnabled(),
  };
}

type AvailabilityFallbackInput = {
  hasTmdbAvailability: boolean;
  isCacheExpired: boolean;
  isImportantTitle: boolean;
  userRequestedRefresh?: boolean;
};

export function shouldUseWatchmodeFallback(
  input: AvailabilityFallbackInput
) {
  return (
    !input.hasTmdbAvailability ||
    input.isCacheExpired ||
    input.isImportantTitle ||
    input.userRequestedRefresh === true
  );
}

type MovieOfTheNightInput = {
  isImportantTitle: boolean;
  isRadarSync: boolean;
  isBulkList: boolean;
  isRealtimeUiRequest: boolean;
};

export function shouldUseMovieOfTheNight(
  input: MovieOfTheNightInput
) {
  if (input.isBulkList) return false;
  if (input.isRealtimeUiRequest) return false;

  return input.isRadarSync || input.isImportantTitle;
}

type OmdbEnrichmentInput = {
  hasImdbId: boolean;
  isTitlePage: boolean;
  isSavedTitle: boolean;
  isBulkList: boolean;
};

export function shouldUseOmdbEnrichment(
  input: OmdbEnrichmentInput
) {
  if (!input.hasImdbId) return false;
  if (input.isBulkList) return false;

  return input.isTitlePage || input.isSavedTitle;
}
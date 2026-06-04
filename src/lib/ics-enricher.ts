import type { IcsSeriesGroup } from "./ics-engine";

export async function enrichSeriesGroups(
  _groups: IcsSeriesGroup[],
  _opts?: { accessToken?: string; concurrency?: number },
): Promise<void> {
  // TMDB ICS enrichment permanently disabled
}

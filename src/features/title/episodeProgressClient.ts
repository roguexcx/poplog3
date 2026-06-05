"use client";

export type EpisodeProgressResponse = {
  ok?: boolean;
  progress?: {
    watchedCount?: number;
    watchedKeys?: string[];
  };
  watchedKeys?: string[];
  error?: string;
};

export type EpisodeProgressBulkItem = {
  seasonNumber: number;
  episodeNumber: number;
  runtimeMinutes: number | null;
};

export function toPositiveTmdbId(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return 0;
}

/** Like toPositiveTmdbId but also accepts negative synthetic IDs (imdbId-based). */
export function toAnyTmdbId(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value !== 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed) && parsed !== 0) {
      return Math.floor(parsed);
    }
  }

  return 0;
}

export function episodeKey(season: number, episode: number) {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export function dispatchSeriesProgressRefresh(seriesTmdbId: number) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("poplog3:series-progress-refresh", {
      detail: { seriesTmdbId },
    })
  );
}

export function dispatchLibraryStatusChanged(
  seriesTmdbId: number,
  status: string
) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent("poplog3:library-status-changed", {
      detail: { tmdbId: seriesTmdbId, status },
    })
  );
}

async function readEpisodeApiError(res: Response) {
  try {
    const data = (await res.json()) as { error?: unknown };

    if (typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }
  } catch {
    // Keep the status fallback below when the response is not JSON.
  }

  return `episodes ${res.status}`;
}

export async function postEpisodeProgress(
  payload: Record<string, unknown>
): Promise<EpisodeProgressResponse> {
  const res = await fetch("/api/poplog3/episodes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(await readEpisodeApiError(res));
  }

  return (await res.json()) as EpisodeProgressResponse;
}

export async function markEpisodesUntil(input: {
  seriesTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
}) {
  return postEpisodeProgress({
    seriesTmdbId: input.seriesTmdbId,
    markUntil: {
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
    },
  });
}

export async function markSeasonProgress(input: {
  seriesTmdbId: number;
  seasonNumber: number;
}) {
  return postEpisodeProgress({
    seriesTmdbId: input.seriesTmdbId,
    markSeason: input.seasonNumber,
  });
}

export async function clearSeriesProgress(input: { seriesTmdbId: number }) {
  return postEpisodeProgress({
    seriesTmdbId: input.seriesTmdbId,
    clear: true,
  });
}

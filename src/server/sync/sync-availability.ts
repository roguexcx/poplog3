import { logApiCall } from "@/server/engine-logger";
import { motnFetch } from "@/server/api-clients/movieofthenight/client";
import type { MotnTitleResponse } from "@/server/api-clients/movieofthenight/types";
import { watchmodeFetch } from "@/server/api-clients/watchmode/client";
import type { WatchmodeSource } from "@/server/api-clients/watchmode/types";

import {
  getAvailability,
  isAvailabilityFresh,
  replaceAvailability,
  type AvailabilityRow,
  type AvailabilitySource,
  type AvailabilityType,
} from "@/server/cache/availability-cache";

type MediaType = "movie" | "tv";

type TmdbProviderEntry = {
  provider_id?: number;
  provider_name?: string;
  logo_path?: string | null;
  display_priority?: number;
};

type TmdbWatchProvidersPayload = {
  results?: Record<
    string,
    {
      link?: string;
      flatrate?: TmdbProviderEntry[];
      rent?: TmdbProviderEntry[];
      buy?: TmdbProviderEntry[];
      free?: TmdbProviderEntry[];
      ads?: TmdbProviderEntry[];
    }
  >;
};

export type TmdbPayloadWithWatch = {
  ["watch/providers"]?: TmdbWatchProvidersPayload;
};

export type SyncAvailabilityInput = {
  tmdbId: number;
  mediaType: MediaType;
  country?: string;
  tmdbPayload?: TmdbPayloadWithWatch | null;
  imdbId?: string | null;
  force?: boolean;
  maxAgeDays?: number;
};

export type SyncAvailabilityResult = {
  source: AvailabilitySource | "cache" | "none";
  rows: AvailabilityRow[];
  diagnostics: {
    tmdb: "ok" | "empty" | "not_attempted";
    watchmode: "ok" | "empty" | "failed" | "not_attempted";
    motn: "ok" | "empty" | "failed" | "not_attempted";
  };
};

function tmdbCategoryToType(category: string): AvailabilityType | null {
  switch (category) {
    case "flatrate":
      return "streaming";
    case "rent":
      return "rent";
    case "buy":
      return "buy";
    case "free":
      return "free";
    case "ads":
      return "ads";
    default:
      return null;
  }
}

function motnTypeToAvailabilityType(t: string | undefined): AvailabilityType | null {
  if (!t) return null;

  switch (t) {
    case "subscription":
    case "addon":
      return "streaming";
    case "rent":
      return "rent";
    case "buy":
      return "buy";
    case "free":
      return "free";
    default:
      return null;
  }
}

function watchmodeTypeToAvailabilityType(t: string | undefined): AvailabilityType | null {
  if (!t) return null;

  switch (t) {
    case "sub":
    case "subscription":
      return "streaming";
    case "rent":
      return "rent";
    case "buy":
    case "purchase":
      return "buy";
    case "free":
      return "free";
    case "ads":
    case "tve":
      return "ads";
    default:
      return null;
  }
}

function extractTmdbRows(
  payload: TmdbWatchProvidersPayload | null | undefined,
  country: string
): Array<{
  providerName: string;
  providerLogoPath: string | null;
  tmdbProviderId: number | null;
  availabilityType: AvailabilityType;
  rawPayload: TmdbProviderEntry;
}> {
  const bucket = payload?.results?.[country];
  if (!bucket) return [];

  const rows: Array<{
    providerName: string;
    providerLogoPath: string | null;
    tmdbProviderId: number | null;
    availabilityType: AvailabilityType;
    rawPayload: TmdbProviderEntry;
  }> = [];

  for (const category of ["flatrate", "rent", "buy", "free", "ads"] as const) {
    const items = bucket[category];
    if (!items || items.length === 0) continue;

    const availabilityType = tmdbCategoryToType(category);
    if (!availabilityType) continue;

    for (const entry of items) {
      if (!entry.provider_name) continue;

      rows.push({
        providerName: entry.provider_name,
        providerLogoPath: entry.logo_path ?? null,
        tmdbProviderId: entry.provider_id ?? null,
        availabilityType,
        rawPayload: entry,
      });
    }
  }

  return rows;
}

async function fetchWatchmodeRows(
  tmdbId: number,
  mediaType: MediaType,
  country: string,
  imdbId: string | null
): Promise<Array<{
  providerName: string;
  providerLogoPath: string | null;
  tmdbProviderId: number | null;
  availabilityType: AvailabilityType;
  deepLink: string | null;
  rawPayload: WatchmodeSource;
}>> {
  const titleKey = imdbId ?? `${mediaType === "tv" ? "tv" : "movie"}-${tmdbId}`;

  const data = await watchmodeFetch<{ sources?: WatchmodeSource[] }>(
    `/title/${titleKey}/sources/?regions=${country}`
  );

  const sources = data.sources ?? [];

    const rows: Array<{
    providerName: string;
    providerLogoPath: string | null;
    tmdbProviderId: number | null;
    availabilityType: AvailabilityType;
    deepLink: string | null;
    rawPayload: WatchmodeSource;
  }> = [];

  for (const source of sources) {
    if (country && source.region !== country) continue;

    const availabilityType = watchmodeTypeToAvailabilityType(source.type);
    if (!availabilityType) continue;

    rows.push({
      providerName: source.name ?? "Desconhecido",
      providerLogoPath: null,
      tmdbProviderId: null,
      availabilityType,
      deepLink: source.web_url ?? null,
      rawPayload: source,
    });
  }

  return rows;
}

async function fetchMotnRows(
  tmdbId: number,
  mediaType: MediaType,
  country: string
): Promise<Array<{
  providerName: string;
  providerLogoPath: string | null;
  tmdbProviderId: number | null;
  availabilityType: AvailabilityType;
  deepLink: string | null;
  quality: string | null;
  rawPayload: unknown;
}>> {
  const motnType = mediaType === "movie" ? "movie" : "series";

  const data = await motnFetch<MotnTitleResponse>(
    `/shows/${motnType}/tmdb/${tmdbId}?country=${country.toLowerCase()}`
  );

  const options =
    data.streamingOptions?.[country.toLowerCase()] ??
    data.streamingOptions?.[country] ??
    [];


    const rows: Array<{
    providerName: string;
    providerLogoPath: string | null;
    tmdbProviderId: number | null;
    availabilityType: AvailabilityType;
    deepLink: string | null;
    quality: string | null;
    rawPayload: unknown;
  }> = [];

  for (const option of options) {
    const availabilityType = motnTypeToAvailabilityType(option.type);
    if (!availabilityType) continue;

    rows.push({
      providerName: option.service?.name ?? option.service?.id ?? "Desconhecido",
      providerLogoPath: null,
      tmdbProviderId: null,
      availabilityType,
      deepLink: option.link ?? null,
      quality: option.quality ?? null,
      rawPayload: option,
    });
  }

  return rows;
}

export async function syncAvailability(
  input: SyncAvailabilityInput
): Promise<SyncAvailabilityResult> {
  const t0 = Date.now();
  const country = input.country ?? "BR";
  const { tmdbId, mediaType } = input;
  const maxAgeDays = input.maxAgeDays ?? 7;

  const cached = await getAvailability(mediaType, tmdbId, country);

  if (!input.force && cached.length > 0 && isAvailabilityFresh(cached, maxAgeDays)) {
    logApiCall({
      api: "tmdb",
      op: "sync-availability",
      mediaType,
      tmdbId,
      cacheStatus: "hit",
      durationMs: Date.now() - t0,
      success: true,
    });
    return {
      source: "cache",
      rows: cached,
      diagnostics: {
        tmdb: "not_attempted",
        watchmode: "not_attempted",
        motn: "not_attempted",
      },
    };
  }

  const diagnostics: SyncAvailabilityResult["diagnostics"] = {
    tmdb: "not_attempted",
    watchmode: "not_attempted",
    motn: "not_attempted",
  };

  const tmdbRows = extractTmdbRows(input.tmdbPayload?.["watch/providers"], country);

  if (tmdbRows.length > 0) {
    diagnostics.tmdb = "ok";

    await replaceAvailability({
      tmdbId,
      mediaType,
      country,
      source: "tmdb",
      rows: tmdbRows,
    });

    await Promise.all([
      replaceAvailability({ tmdbId, mediaType, country, source: "watchmode", rows: [] }),
      replaceAvailability({ tmdbId, mediaType, country, source: "motn", rows: [] }),
    ]);

    const fresh = await getAvailability(mediaType, tmdbId, country);

    logApiCall({
      api: "tmdb",
      op: "sync-availability",
      mediaType,
      tmdbId,
      cacheStatus: "miss",
      durationMs: Date.now() - t0,
      success: true,
    });

    return {
      source: "tmdb",
      rows: fresh.filter((row) => row.source === "tmdb"),
      diagnostics,
    };
  }

  diagnostics.tmdb = "empty";

  try {
    const watchmodeRows = await fetchWatchmodeRows(
      tmdbId,
      mediaType,
      country,
      input.imdbId ?? null
    );

    if (watchmodeRows.length > 0) {
      diagnostics.watchmode = "ok";

      await replaceAvailability({ tmdbId, mediaType, country, source: "watchmode", rows: watchmodeRows });

      const fresh = await getAvailability(mediaType, tmdbId, country);

      logApiCall({
        api: "watchmode",
        op: "sync-availability",
        mediaType,
        tmdbId,
        cacheStatus: "miss",
        durationMs: Date.now() - t0,
        success: true,
        fallbackFrom: "tmdb",
      });

      return {
        source: "watchmode",
        rows: fresh.filter((row) => row.source === "watchmode"),
        diagnostics,
      };
    }

    diagnostics.watchmode = "empty";
  } catch (error) {
    console.warn(
      "[sync-availability] watchmode falhou:",
      error instanceof Error ? error.message : error
    );

    diagnostics.watchmode = "failed";

    logApiCall({
      api: "watchmode",
      op: "sync-availability",
      mediaType,
      tmdbId,
      cacheStatus: "failed",
      durationMs: Date.now() - t0,
      success: false,
      fallbackFrom: "tmdb",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const motnRows = await fetchMotnRows(tmdbId, mediaType, country);

    if (motnRows.length > 0) {
      diagnostics.motn = "ok";

      await replaceAvailability({ tmdbId, mediaType, country, source: "motn", rows: motnRows });

      const fresh = await getAvailability(mediaType, tmdbId, country);

      logApiCall({
        api: "motn",
        op: "sync-availability",
        mediaType,
        tmdbId,
        cacheStatus: "miss",
        durationMs: Date.now() - t0,
        success: true,
        fallbackFrom: "watchmode",
      });

      return {
        source: "motn",
        rows: fresh.filter((row) => row.source === "motn"),
        diagnostics,
      };
    }

    diagnostics.motn = "empty";
  } catch (error) {
    console.warn(
      "[sync-availability] motn falhou:",
      error instanceof Error ? error.message : error
    );

    diagnostics.motn = "failed";

    logApiCall({
      api: "motn",
      op: "sync-availability",
      mediaType,
      tmdbId,
      cacheStatus: "failed",
      durationMs: Date.now() - t0,
      success: false,
      fallbackFrom: "watchmode",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    source: "none",
    rows: [],
    diagnostics,
  };
}
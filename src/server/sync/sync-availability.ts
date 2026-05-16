import { motnFetch } from "@/server/api-clients/movieofthenight/client";
import type { MotnTitleResponse } from "@/server/api-clients/movieofthenight/types";
import { watchmodeFetch } from "@/server/api-clients/watchmode/client";
import type { WatchmodeSource } from "@/server/api-clients/watchmode/types";

import { buildAvailabilityProviders } from "@/server/streaming/availability-service";

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
  /** Payload TMDB completo já em memoria (do sync-tmdb-title). */
  tmdbPayload?: TmdbPayloadWithWatch | null;
  /** IMDb id pra fallback Watchmode. */
  imdbId?: string | null;
  /** Forca refetch ignorando frescor. */
  force?: boolean;
  /** Janela de frescor em dias. Default 7. */
  maxAgeDays?: number;
};

export type SyncAvailabilityResult = {
  source: AvailabilitySource | "cache" | "none";
  rows: AvailabilityRow[];
  /** Por que cada source nao retornou nada (debug). */
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
      return "streaming";
    case "rent":
      return "rent";
    case "buy":
      return "buy";
    case "free":
      return "free";
    case "addon":
      return "streaming";
    default:
      return null;
  }
}

function watchmodeTypeToAvailabilityType(
  t: string | undefined
): AvailabilityType | null {
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
    const t = tmdbCategoryToType(category);
    if (!t) continue;
    for (const entry of items) {
      if (!entry.provider_name) continue;
      rows.push({
        providerName: entry.provider_name,
        providerLogoPath: entry.logo_path ?? null,
        tmdbProviderId: entry.provider_id ?? null,
        availabilityType: t,
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

  // Watchmode aceita imdb_id direto OU tmdb_id no formato 'movie-XXX' / 'tv-XXX'.
  const data = await watchmodeFetch<{ sources?: WatchmodeSource[] }>(
    `/title/${titleKey}/sources/?regions=${country}`
  );

  const sources = data.sources ?? [];
  return sources
    .filter((s) => !country || s.region === country)
    .map((s) => {
      const t = watchmodeTypeToAvailabilityType(s.type);
      if (!t) return null;
      return {
        providerName: s.name ?? "Desconhecido",
        providerLogoPath: null,
        tmdbProviderId: null,
        availabilityType: t,
        deepLink: s.web_url ?? null,
        rawPayload: s,
      };
    })
    .filter(Boolean) as Array<{
    providerName: string;
    providerLogoPath: string | null;
    tmdbProviderId: number | null;
    availabilityType: AvailabilityType;
    deepLink: string | null;
    rawPayload: WatchmodeSource;
  }>;
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
    `/shows/${motnType}/tmdb/${tmdbId === undefined ? "" : tmdbId}?country=${country.toLowerCase()}`
  );

  const options =
    data.streamingOptions?.[country.toLowerCase()] ??
    data.streamingOptions?.[country] ??
    [];

  return options
    .map((opt) => {
      const t = motnTypeToAvailabilityType(opt.type);
      if (!t) return null;
      return {
        providerName: opt.service?.name ?? opt.service?.id ?? "Desconhecido",
        providerLogoPath: null,
        tmdbProviderId: null,
        availabilityType: t,
        deepLink: opt.link ?? null,
        quality: opt.quality ?? null,
        rawPayload: opt,
      };
    })
    .filter(Boolean) as Array<{
    providerName: string;
    providerLogoPath: string | null;
    tmdbProviderId: number | null;
    availabilityType: AvailabilityType;
    deepLink: string | null;
    quality: string | null;
    rawPayload: unknown;
  }>;
}

/**
 * Sync de disponibilidade com fallback ESTRITO:
 *   1. TMDB (raiz primaria — usa watch/providers ja apendado ao sync principal)
 *   2. Watchmode (so quando TMDB nao retornar resultado pro pais)
 *   3. MotN (so quando Watchmode tambem nao retornar)
 *
 * Cada source vive em sua propria linha no banco (single-source-of-truth =
 * a com maior prioridade que ainda for valida). NAO inclui marcador
 * "chegou ha X dias" nesta fase.
 */
export async function syncAvailability(
  input: SyncAvailabilityInput
): Promise<SyncAvailabilityResult> {
  const country = input.country ?? "BR";
  const { tmdbId, mediaType } = input;
  const maxAgeDays = input.maxAgeDays ?? 7;

  const cached = await getAvailability(mediaType, tmdbId, country);

  if (!input.force && cached.length > 0 && isAvailabilityFresh(cached, maxAgeDays)) {
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

  // 1. TMDB — base primaria, vem do sync-tmdb-title direto na memoria.
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
    const fresh = await getAvailability(mediaType, tmdbId, country);
    // Limpa fallback sources se TMDB devolveu — TMDB e a verdade.
    await Promise.all([
      replaceAvailability({
        tmdbId,
        mediaType,
        country,
        source: "watchmode",
        rows: [],
      }),
      replaceAvailability({
        tmdbId,
        mediaType,
        country,
        source: "motn",
        rows: [],
      }),
    ]);
    return {
      source: "tmdb",
      rows: fresh.filter((r) => r.source === "tmdb"),
      diagnostics,
    };
  }
  diagnostics.tmdb = "empty";

  // 2. Watchmode — fallback estrito.
  try {
    const watchmodeRows = await fetchWatchmodeRows(
      tmdbId,
      mediaType,
      country,
      input.imdbId ?? null
    );
    if (watchmodeRows.length > 0) {
      diagnostics.watchmode = "ok";
      await replaceAvailability({
        tmdbId,
        mediaType,
        country,
        source: "watchmode",
        rows: watchmodeRows,
      });
      const fresh = await getAvailability(mediaType, tmdbId, country);

buildAvailabilityProviders(
  fresh
    .filter((r) => r.source === "tmdb")
    .map((row) => ({
      providerId: row.tmdb_provider_id ?? 0,
      providerName: row.provider_name,
      logoPath: row.provider_logo_path,
      type: row.availability_type,
      deeplink: row.deep_link,
      source: row.source,
      quality: null,
    })),
  {
    region: country,
  },
);

return {
  source: "tmdb",
  rows: fresh.filter((r) => r.source === "tmdb"),
  diagnostics,
};
    }
    diagnostics.watchmode = "empty";
  } catch (err) {
    console.warn(
      "[sync-availability] watchmode falhou:",
      err instanceof Error ? err.message : err
    );
    diagnostics.watchmode = "failed";
  }

  // 3. MotN — fallback final.
  try {
    const motnRows = await fetchMotnRows(tmdbId, mediaType, country);
    if (motnRows.length > 0) {
      diagnostics.motn = "ok";
      await replaceAvailability({
        tmdbId,
        mediaType,
        country,
        source: "motn",
        rows: motnRows,
      });
      const fresh = await getAvailability(mediaType, tmdbId, country);

buildAvailabilityProviders(
  fresh
    .filter((r) => r.source === selectedSource)
    .map((row) => ({
      providerId: row.tmdb_provider_id ?? 0,
      providerName: row.provider_name,
      logoPath: row.provider_logo_path,
      type: row.availability_type,
      deeplink: row.deep_link,
      source: row.source,
      quality: row.quality,
    })),
  {
    region: country,
  },
);

return {
  source: selectedSource,
  rows: fresh.filter((r) => r.source === selectedSource),
  diagnostics,
};
    }
    diagnostics.motn = "empty";
  } catch (err) {
    console.warn(
      "[sync-availability] motn falhou:",
      err instanceof Error ? err.message : err
    );
    diagnostics.motn = "failed";
  }

  return { source: "none", rows: [], diagnostics };
}

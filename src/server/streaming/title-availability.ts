import type {
  TitleAvailability,
  TitleAvailabilityRegion,
  TitleAvailabilityWindowStatus,
  TitleMediaType,
  TitleProvider,
} from "@/features/title/types";
import { getAvailability, type AvailabilityRow } from "@/server/cache/availability-cache";
import {
  syncAvailability,
  type TmdbPayloadWithWatch,
} from "@/server/sync/sync-availability";

import {
  buildAvailabilityProviders,
  getBestAvailabilityProvider,
  type AvailabilityProvider,
} from "./availability-service";
import type { ProviderPreferenceInput } from "./provider-preferences";
import { buildTmdbRawUrl } from "@/lib/images/url";

export type AvailabilityPriorityContext =
  | "library"
  | "watching"
  | "watchlist"
  | "title_page"
  | "hero"
  | "home"
  | "radar"
  /** Legacy alias accepted during the Agenda -> Radar transition. */
  | "agenda"
  | "search"
  | "background";

export type ReleaseWindow =
  | "unknown"
  | "cinema_0_30"
  | "vod_light_30_45"
  | "vod_critical_45_90"
  | "streaming_transition_90_180"
  | "stable_180_plus";

export type GetTitleAvailabilityInput = {
  tmdbId: number;
  mediaType: TitleMediaType;
  tmdbPayload?: TmdbPayloadWithWatch | null;
  imdbId?: string | null;
  force?: boolean;
  preferences?: ProviderPreferenceInput | null;
  releaseDate?: string | null;
  firstAirDate?: string | null;
  popularity?: number | null;
  contexts?: AvailabilityPriorityContext[];
  userId?: string | null;
  action?: string | null;
  endpoint?: string;
};

export type TitleAvailabilityResult = {
  availability: TitleAvailability;
  providers: AvailabilityProvider[];
  cacheInfo: {
    source: string;
    tmdb: string;
    watchmode: string;
    motn: string;
  };
};

type AvailabilityMode = "display" | "user_title_refresh" | "admin_refresh";

function tmdbImage(path: string | null | undefined, size: string): string | null {
  return buildTmdbRawUrl(size, path);
}

function daysSinceDate(value?: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor((Date.now() - time) / 86_400_000);
}

export function getReleaseWindow(input: {
  mediaType: TitleMediaType;
  releaseDate?: string | null;
  firstAirDate?: string | null;
}): ReleaseWindow {
  const date = input.mediaType === "movie" ? input.releaseDate : input.firstAirDate;
  const age = daysSinceDate(date);

  if (age === null) return "unknown";
  if (input.mediaType !== "movie") return age <= 180 ? "streaming_transition_90_180" : "stable_180_plus";
  if (age <= 30) return "cinema_0_30";
  if (age <= 45) return "vod_light_30_45";
  if (age <= 90) return "vod_critical_45_90";
  if (age <= 180) return "streaming_transition_90_180";
  return "stable_180_plus";
}

export function getAvailabilityMaxAgeDays(input: {
  window: ReleaseWindow;
  contexts?: AvailabilityPriorityContext[];
  popularity?: number | null;
}): number {
  const contexts = new Set(input.contexts ?? []);
  const highPriority =
    contexts.has("library") ||
    contexts.has("watching") ||
    contexts.has("watchlist") ||
    contexts.has("title_page") ||
    contexts.has("hero") ||
    (input.popularity ?? 0) >= 250;

  switch (input.window) {
    case "cinema_0_30":
      return highPriority ? 5 : 14;
    case "vod_light_30_45":
      return highPriority ? 2 : 7;
    case "vod_critical_45_90":
      return highPriority ? 1 : 3;
    case "streaming_transition_90_180":
      return highPriority ? 2 : 7;
    case "stable_180_plus":
      return highPriority ? 7 : 21;
    case "unknown":
    default:
      return highPriority ? 3 : 10;
  }
}

function rowToProvider(row: AvailabilityRow): TitleProvider {
  return {
    name: row.provider_name,
    logoUrl: tmdbImage(row.provider_logo_path, "w92"),
    type: row.availability_type,
    deepLink: row.deep_link,
    quality: row.quality,
    country: row.country,
    source: row.source === "motn" ? "movieofthenight" : row.source,
    providerId: row.tmdb_provider_id ?? row.provider_id ?? null,
    tmdbProviderId: row.tmdb_provider_id ?? null,
    providerName: row.provider_name,
    logoPath: row.provider_logo_path,
    deeplink: row.deep_link,
  };
}

function buildRegion(
  region: "BR" | "US",
  rows: AvailabilityRow[],
  preferences?: ProviderPreferenceInput | null,
): TitleAvailabilityRegion {
  const providers = buildAvailabilityProviders(rows.map(rowToProvider), {
    region,
    preferences: preferences ?? undefined,
  });
  const primaryProvider = getBestAvailabilityProvider(providers);
  const subscriptionProviders = providers.filter((provider) =>
    ["subscription", "free", "ads"].includes(provider.normalizedType),
  );
  const vodProviders = providers.filter((provider) =>
    ["rent", "buy"].includes(provider.normalizedType),
  );
  const lastSyncedAt = rows
    .map((row) => row.last_synced_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    region,
    providers,
    primaryProvider,
    subscriptionProviders,
    vodProviders,
    hasSubscription: subscriptionProviders.length > 0,
    hasVod: vodProviders.length > 0,
    source: rows[0]?.source ?? "none",
    lastSyncedAt,
  };
}

function resolveStatus(input: {
  br: TitleAvailabilityRegion;
  us: TitleAvailabilityRegion;
  window: ReleaseWindow;
  mediaType: TitleMediaType;
}): TitleAvailabilityWindowStatus {
  if (input.br.hasSubscription) return "streaming_confirmed_br";
  if (input.br.hasVod) return "vod_available_br";
  if (input.us.hasSubscription) return "streaming_confirmed_us";
  if (input.us.hasVod) {
    return input.window === "vod_critical_45_90" ? "pvod_available_us" : "vod_available_us";
  }
  if (input.window === "cinema_0_30") return "cinema";
  if (input.window === "vod_light_30_45") return "digital_prediction";

  const hasAnyRows = input.br.providers.length > 0 || input.us.providers.length > 0;
  if (hasAnyRows) return "regional";
  return "unavailable";
}

function resolvePrimaryProvider(br: TitleAvailabilityRegion, us: TitleAvailabilityRegion) {
  return (
    br.subscriptionProviders[0] ??
    br.vodProviders[0] ??
    us.subscriptionProviders[0] ??
    us.vodProviders[0] ??
    null
  );
}

function resolveOfferType(
  provider: AvailabilityProvider | TitleProvider | null,
  status: TitleAvailabilityWindowStatus,
): TitleAvailability["offerType"] {
  if (status === "cinema") return "cinema";
  if (status === "pvod_available_us") return "pvod";
  if (!provider) return status === "unavailable" ? "none" : "unknown";
  if ("normalizedType" in provider) return provider.normalizedType ?? "unknown";
  return provider.type === "streaming" ? "subscription" : provider.type;
}

function explainAvailability(input: {
  status: TitleAvailabilityWindowStatus;
  provider: TitleProvider | null;
}): string {
  const name = input.provider?.name;
  switch (input.status) {
    case "streaming_confirmed_br":
      return name ? `Chegou ao streaming no Brasil em ${name}.` : "Chegou ao streaming no Brasil.";
    case "streaming_confirmed_us":
      return name ? `Disponível em streaming nos EUA em ${name}.` : "Disponível em streaming nos EUA.";
    case "vod_available_br":
      return "Disponível para aluguel ou compra digital no Brasil.";
    case "pvod_available_us":
      return "Radar digital: PVOD disponível nos EUA.";
    case "vod_available_us":
      return "Disponível para aluguel ou compra digital nos EUA.";
    case "digital_prediction":
      return "Janela inicial de previsão digital nos EUA.";
    case "cinema":
      return "Janela provável de cinema; o radar digital fica mais leve por enquanto.";
    case "regional":
    case "partial":
      return "Disponibilidade parcial por região.";
    case "no_data":
      return "Sem dados de disponibilidade.";
    case "unavailable":
    default:
      return "Ainda sem disponibilidade confirmada.";
  }
}

function sourceFromRegions(br: TitleAvailabilityRegion, us: TitleAvailabilityRegion) {
  const sources = [br.source, us.source].filter((source) => source !== "none");
  if (sources.includes("tmdb")) return "tmdb";
  return sources[0] ?? "none";
}

function getPremiumAvailabilityTtlDays(input: {
  window: ReleaseWindow;
  contexts?: AvailabilityPriorityContext[];
}) {
  const contexts = new Set(input.contexts ?? []);
  const priority =
    contexts.has("hero") ||
    contexts.has("radar") ||
    contexts.has("agenda") ||
    input.window === "cinema_0_30" ||
    input.window === "vod_light_30_45" ||
    input.window === "vod_critical_45_90" ||
    input.window === "streaming_transition_90_180";

  if (!priority) return 15;
  if (input.window === "vod_critical_45_90") return 1;
  return 3;
}

async function resolveTitleAvailability(
  input: GetTitleAvailabilityInput,
  mode: AvailabilityMode,
): Promise<TitleAvailabilityResult> {
  const window = getReleaseWindow(input);
  const maxAgeDays = getAvailabilityMaxAgeDays({
    window,
    contexts: input.contexts,
    popularity: input.popularity,
  });
  const premiumTtlDays = getPremiumAvailabilityTtlDays({
    window,
    contexts: input.contexts,
  });

  const [brSync, usSync] = await Promise.all([
    syncAvailability({
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      country: "BR",
      tmdbPayload: input.tmdbPayload,
      imdbId: input.imdbId,
      force: input.force,
      maxAgeDays,
      premiumTtlDays,
      allowExternalFallback: mode !== "display",
      origin: {
        endpoint:
          input.endpoint ??
          (mode === "admin_refresh"
            ? "admin/backfill/refresh"
            : mode === "user_title_refresh"
              ? "library:user-title-refresh"
              : "display"),
        userId: input.userId ?? null,
        action: input.action ?? mode,
        reason:
          mode === "admin_refresh"
            ? "admin_controlled_refresh_tmdb_empty_or_cache_expired"
            : mode === "user_title_refresh"
            ? "explicit_user_library_state_tmdb_empty_or_cache_expired"
            : "display_render_tmdb_only",
      },
    }),
    syncAvailability({
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      country: "US",
      tmdbPayload: input.tmdbPayload,
      imdbId: input.imdbId,
      force: input.force,
      maxAgeDays,
      premiumTtlDays,
      allowExternalFallback: mode !== "display",
      origin: {
        endpoint:
          input.endpoint ??
          (mode === "admin_refresh"
            ? "admin/backfill/refresh"
            : mode === "user_title_refresh"
              ? "library:user-title-refresh"
              : "display"),
        userId: input.userId ?? null,
        action: input.action ?? mode,
        reason:
          mode === "admin_refresh"
            ? "admin_controlled_refresh_tmdb_empty_or_cache_expired"
            : mode === "user_title_refresh"
            ? "explicit_user_library_state_tmdb_empty_or_cache_expired"
            : "display_render_tmdb_only",
      },
    }),
  ]);

  const [brRows, usRows] = await Promise.all([
    brSync.rows.length ? Promise.resolve(brSync.rows) : getAvailability(input.mediaType, input.tmdbId, "BR"),
    usSync.rows.length ? Promise.resolve(usSync.rows) : getAvailability(input.mediaType, input.tmdbId, "US"),
  ]);

  const br = buildRegion("BR", brRows, input.preferences);
  const us = buildRegion("US", usRows, input.preferences);
  const status = resolveStatus({ br, us, window, mediaType: input.mediaType });
  const primaryProvider = resolvePrimaryProvider(br, us);
  const source = sourceFromRegions(br, us);
  const fallbackSource =
    source === "watchmode"
      ? "watchmode"
      : source === "motn"
        ? "movieofthenight"
        : null;

  const availability: TitleAvailability = {
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    primaryRegion: "BR",
    radarRegion: "US",
    status,
    offerType: resolveOfferType(primaryProvider, status),
    primaryProvider,
    regions: { BR: br, US: us },
    isFallback: fallbackSource !== null,
    fallbackSource,
    confidence: primaryProvider?.confidence ?? (status === "unavailable" ? "tmdb_empty" : "predicted_window"),
    refreshedAt: new Date().toISOString(),
    nextRefreshAfterDays: maxAgeDays,
    explanation: explainAvailability({ status, provider: primaryProvider }),
  };

  return {
    availability,
    providers: br.providers as AvailabilityProvider[],
    cacheInfo: {
      source,
      tmdb: brSync.diagnostics.tmdb === "ok" || usSync.diagnostics.tmdb === "ok" ? "ok" : brSync.diagnostics.tmdb,
      watchmode:
        brSync.diagnostics.watchmode === "ok" || usSync.diagnostics.watchmode === "ok"
          ? "ok"
          : brSync.diagnostics.watchmode,
      motn:
        brSync.diagnostics.motn === "ok" || usSync.diagnostics.motn === "ok"
          ? "ok"
          : brSync.diagnostics.motn,
    },
  };
}

export async function getAvailabilityForDisplay(
  input: GetTitleAvailabilityInput,
): Promise<TitleAvailabilityResult> {
  return resolveTitleAvailability(input, "display");
}

export async function refreshAvailabilityForUserTitle(
  input: GetTitleAvailabilityInput & {
    userId: string;
    action: string;
    endpoint: string;
  },
): Promise<TitleAvailabilityResult> {
  return resolveTitleAvailability(input, "user_title_refresh");
}

export async function refreshAvailabilityForAdmin(
  input: GetTitleAvailabilityInput & {
    endpoint?: string;
    action?: string;
  },
): Promise<TitleAvailabilityResult> {
  return resolveTitleAvailability(
    {
      ...input,
      endpoint: input.endpoint ?? "admin/backfill/refresh",
      action: input.action ?? "admin_refresh",
    },
    "admin_refresh",
  );
}

export async function getTitleAvailability(
  input: GetTitleAvailabilityInput,
): Promise<TitleAvailabilityResult> {
  return getAvailabilityForDisplay(input);
}
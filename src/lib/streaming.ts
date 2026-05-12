// src/lib/streaming.ts
// Utilitário centralizado de providers e status de streaming.
// Consumido pela página de título e pelo /api/watchlist/live.

import { tmdbFetch } from "@/lib/tmdb";
import {
  getCachedStreamingAvailability,
  setCachedStreamingAvailability,
  shouldRefreshStreamingAvailability,
} from "@/lib/streaming-cache";

// ─── Types públicos ───────────────────────────────────────────────────────────

export type StreamStatus =
  | "streaming"
  | "chegando"
  | "cinemas"
  | "confirmado"
  | "unavailable";

export type StreamingAccessType =
  | "subscription"
  | "rent"
  | "buy"
  | "free"
  | "ads"
  | "cinema"
  | "unknown";

export type StreamingSourceApi =
  | "tmdb"
  | "watchmode"
  | "movieofthenight"
  | "inference"
  | "cache";

export type StreamingAvailabilityStatus =
  | "available_subscription"
  | "available_rent"
  | "available_buy"
  | "available_free"
  | "available_abroad"
  | "cinema_now"
  | "upcoming"
  | "recently_released"
  | "digital_expected"
  | "unavailable"
  | "unknown";

export type StreamingProvider = {
  providerId: number;
  providerName: string;
  providerSlug: string;
  logoUrl: string;
  country: string;
  accessTypes: StreamingAccessType[];
  sourceApi: StreamingSourceApi;
  confidence: number;
  deepLink?: string;
  inferred?: boolean;
  id: number;
  name: string;
  logo: string;
};

export type StreamingAvailabilityResult = {
  tmdbId: number;
  imdbId?: string | null;
  mediaType: "movie" | "tv";
  country: string;
  providers: StreamingProvider[];
  streamStatus: StreamingAvailabilityStatus;
  legacyStreamStatus: StreamStatus;
  accessTypes: StreamingAccessType[];
  availableInCountry: boolean;
  availableAbroad: boolean;
  estimatedPlatform: string | null;
  estimatedMonth: string | null;
  estimatedPvodMonth: string | null;
  sourceApis: StreamingSourceApi[];
  confidenceScore: number;
  inferred: boolean;
  origin: "cinema" | "streaming";
  contextPool: string[];
  lastCheckedAt: string;
  rawProviderData?: unknown;
  debugNotes?: string[];
  flatrate: StreamingProvider[];
  free: StreamingProvider[];
  ads: StreamingProvider[];
  rent: StreamingProvider[];
  buy: StreamingProvider[];
};

export type StreamingInfo = {
  // Providers brasileiros por categoria
  flatrate: StreamingProvider[];
  free: StreamingProvider[];
  ads: StreamingProvider[];
  rent: StreamingProvider[];
  buy: StreamingProvider[];
  // True quando não há providers BR mas existem providers nos EUA
  availableAbroad: boolean;
  // Dados derivados (usados pelo watchlist; ignorados pela página de título)
  streamStatus: StreamStatus;
  origin: "cinema" | "streaming";
  estimatedPlatform: string | null;
  estimatedMonth: string | null;
  estimatedPvodMonth: string | null;
  // True quando o status "confirmado" é inferido por janela SVOD, não confirmado pelo TMDB
  inferred: boolean;
  contextPool: string[];
  availability: StreamingAvailabilityResult;
  providers: StreamingProvider[];
  accessTypes: StreamingAccessType[];
  availableInCountry: boolean;
  sourceApis: StreamingSourceApi[];
  confidenceScore: number;
  canonicalStreamStatus: StreamingAvailabilityStatus;
  lastCheckedAt: string;
};

export type StreamingOpts = {
  releaseDate?: string | null;
  createdAt?: string;
  seasons?: number | null;
  genre?: string | null;
  productionCompanies?: Array<{ id: number; name: string }>;
  budget?: number;
  revenue?: number;
  forceRefresh?: boolean;
  useCache?: boolean;
};

// ─── STUDIO_MAP ───────────────────────────────────────────────────────────────

type StudioInfo = { platform: string; svodDays: number; pvodDays: number };

const STUDIO_MAP: Record<string, StudioInfo> = {
  "Walt Disney Pictures":    { platform: "Disney+",    svodDays: 105, pvodDays: 45 },
  "Walt Disney Animation":   { platform: "Disney+",    svodDays: 100, pvodDays: 45 },
  Pixar:                     { platform: "Disney+",    svodDays: 100, pvodDays: 45 },
  "Marvel Studios":          { platform: "Disney+",    svodDays: 95,  pvodDays: 45 },
  Lucasfilm:                 { platform: "Disney+",    svodDays: 95,  pvodDays: 45 },
  "Searchlight Pictures":    { platform: "Disney+",    svodDays: 110, pvodDays: 45 },
  "20th Century Studios":    { platform: "Disney+",    svodDays: 105, pvodDays: 45 },
  "20th Century Fox":        { platform: "Disney+",    svodDays: 105, pvodDays: 45 },

  "Warner Bros. Pictures":   { platform: "Max",        svodDays: 60,  pvodDays: 45 },
  "New Line Cinema":         { platform: "Max",        svodDays: 60,  pvodDays: 45 },
  "DC Studios":              { platform: "Max",        svodDays: 60,  pvodDays: 45 },

  "Universal Pictures":      { platform: "Peacock",    svodDays: 55,  pvodDays: 35 },
  "DreamWorks Animation":    { platform: "Peacock",    svodDays: 60,  pvodDays: 38 },
  "Amblin Entertainment":    { platform: "Peacock",    svodDays: 60,  pvodDays: 38 },
  "Focus Features":          { platform: "streaming",  svodDays: 45,  pvodDays: 17 },

  "Columbia Pictures":       { platform: "Netflix",    svodDays: 75,  pvodDays: 38 },
  "Sony Pictures":           { platform: "Netflix",    svodDays: 75,  pvodDays: 38 },
  "TriStar Pictures":        { platform: "Netflix",    svodDays: 75,  pvodDays: 38 },
  "Screen Gems":             { platform: "Netflix",    svodDays: 75,  pvodDays: 38 },

  "Paramount Pictures":      { platform: "Paramount+", svodDays: 65,  pvodDays: 45 },
  "Paramount Animation":     { platform: "Paramount+", svodDays: 65,  pvodDays: 45 },

  A24:                       { platform: "MUBI",       svodDays: 120, pvodDays: 21 },
  Neon:                      { platform: "streaming",  svodDays: 60,  pvodDays: 30 },
  "Apple Original Films":    { platform: "Apple TV+",  svodDays: 0,   pvodDays: 0  },
  "Amazon MGM Studios":      { platform: "Prime Video",svodDays: 0,   pvodDays: 0  },
  Netflix:                   { platform: "Netflix",    svodDays: 0,   pvodDays: 0  },
};

function getStudioInfo(companies: Array<{ id: number; name: string }>): StudioInfo | null {
  for (const company of companies) {
    const match = STUDIO_MAP[company.name];
    if (match) return match;
    for (const [key, value] of Object.entries(STUDIO_MAP)) {
      if (company.name.includes(key) || key.includes(company.name)) return value;
    }
  }
  return null;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

const PT_MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function daysBetween(a: string, b: string = new Date().toISOString()): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function monthFromNow(releaseDate: string, days: number): string {
  const date = new Date(releaseDate);
  date.setDate(date.getDate() + days);
  return PT_MONTHS[date.getMonth()] ?? "";
}

// ─── Provider parsing ─────────────────────────────────────────────────────────

type ProvidersByCategory = {
  flatrate: StreamingProvider[];
  free:     StreamingProvider[];
  ads:      StreamingProvider[];
  rent:     StreamingProvider[];
  buy:      StreamingProvider[];
};

type TmdbProviderCategory = "flatrate" | "free" | "ads" | "rent" | "buy";

const TMDB_ACCESS_TYPE_MAP: Record<TmdbProviderCategory, StreamingAccessType> = {
  flatrate: "subscription",
  free: "free",
  ads: "ads",
  rent: "rent",
  buy: "buy",
};

function slugifyProviderName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createStreamingProvider(
  raw: Record<string, unknown>,
  country: string,
  accessType: StreamingAccessType,
  confidence: number,
  deepLink?: string,
): StreamingProvider {
  const providerId = Number(raw.provider_id);
  const providerName = String(raw.provider_name ?? "");
  const logoUrl = String(raw.logo_path ?? "");

  return {
    providerId,
    providerName,
    providerSlug: slugifyProviderName(providerName),
    logoUrl,
    country,
    accessTypes: [accessType],
    sourceApi: "tmdb",
    confidence,
    deepLink,
    id: providerId,
    name: providerName,
    logo: logoUrl,
  };
}

function mergeProvider(existing: StreamingProvider, next: StreamingProvider): StreamingProvider {
  const accessTypes = Array.from(new Set([...existing.accessTypes, ...next.accessTypes]));
  const confidence = Math.max(existing.confidence, next.confidence);
  return {
    ...existing,
    accessTypes,
    confidence,
    deepLink: existing.deepLink ?? next.deepLink,
  };
}

export function dedupeStreamingProviders(providers: StreamingProvider[]): StreamingProvider[] {
  const map = new Map<string, StreamingProvider>();
  for (const provider of providers) {
    const key = provider.providerId
      ? `${provider.country}:${provider.providerId}`
      : `${provider.country}:${provider.providerSlug}`;
    const existing = map.get(key);
    map.set(key, existing ? mergeProvider(existing, provider) : provider);
  }
  return Array.from(map.values());
}

function getRegionProviderData(providersData: unknown, region: string): Record<string, unknown> | null {
  if (!providersData || typeof providersData !== "object") return null;
  const results = (providersData as Record<string, unknown>).results;
  if (!results || typeof results !== "object") return null;
  const regionData = (results as Record<string, unknown>)[region];
  if (!regionData || typeof regionData !== "object") return null;
  return regionData as Record<string, unknown>;
}

export function normalizeStreamingProviders(
  providersData: unknown,
  country = "BR",
): StreamingProvider[] {
  const regionData = getRegionProviderData(providersData, country);
  if (!regionData) return [];

  const deepLink = typeof regionData.link === "string" ? regionData.link : undefined;
  const providers: StreamingProvider[] = [];

  for (const category of Object.keys(TMDB_ACCESS_TYPE_MAP) as TmdbProviderCategory[]) {
    const rawList = regionData[category];
    if (!Array.isArray(rawList)) continue;
    for (const raw of rawList as Record<string, unknown>[]) {
      providers.push(
        createStreamingProvider(raw, country, TMDB_ACCESS_TYPE_MAP[category], 70, deepLink),
      );
    }
  }

  return dedupeStreamingProviders(providers);
}

function providersByCategory(providers: StreamingProvider[]): ProvidersByCategory {
  const categorized: ProvidersByCategory = { flatrate: [], free: [], ads: [], rent: [], buy: [] };
  for (const provider of providers) {
    if (provider.accessTypes.includes("subscription")) categorized.flatrate.push(provider);
    if (provider.accessTypes.includes("free")) categorized.free.push(provider);
    if (provider.accessTypes.includes("ads")) categorized.ads.push(provider);
    if (provider.accessTypes.includes("rent")) categorized.rent.push(provider);
    if (provider.accessTypes.includes("buy")) categorized.buy.push(provider);
  }
  return categorized;
}

function extractProviders(providersData: unknown, region: string): ProvidersByCategory {
  return providersByCategory(normalizeStreamingProviders(providersData, region));
}

function hasAnyProvider(providers: ProvidersByCategory): boolean {
  return (
    providers.flatrate.length > 0 ||
    providers.free.length > 0 ||
    providers.ads.length > 0 ||
    providers.rent.length > 0 ||
    providers.buy.length > 0
  );
}

function getAccessTypes(providers: StreamingProvider[]): StreamingAccessType[] {
  return Array.from(new Set(providers.flatMap((provider) => provider.accessTypes)));
}

/* Legacy parser kept private for compatibility with older category consumers. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function legacyExtractProviders(providersData: unknown, region: string): ProvidersByCategory {
  const empty: ProvidersByCategory = { flatrate: [], free: [], ads: [], rent: [], buy: [] };
  if (!providersData || typeof providersData !== "object") return empty;
  const results = (providersData as Record<string, unknown>).results;
  if (!results || typeof results !== "object") return empty;
  const regionData = (results as Record<string, unknown>)[region];
  if (!regionData || typeof regionData !== "object") return empty;
  const regionObj = regionData as Record<string, unknown>;

  function toList(raw: unknown, accessType: StreamingAccessType): StreamingProvider[] {
    if (!Array.isArray(raw)) return [];
    return (raw as Record<string, unknown>[]).map((p) =>
      createStreamingProvider(p, region, accessType, 70),
    );
  }

  return {
    flatrate: toList(regionObj.flatrate, "subscription"),
    free:     toList(regionObj.free, "free"),
    ads:      toList(regionObj.ads, "ads"),
    rent:     toList(regionObj.rent, "rent"),
    buy:      toList(regionObj.buy, "buy"),
  };
}

// ─── Status derivation ────────────────────────────────────────────────────────

function deriveOrigin(
  budget: number,
  revenue: number,
  mediaType: "movie" | "tv",
): "cinema" | "streaming" {
  if (mediaType === "tv") return "streaming";
  if (revenue > 50_000 || budget > 100_000) return "cinema";
  return "streaming";
}

export function deriveStreamStatus(
  origin: "cinema" | "streaming",
  releaseDate: string,
  hasSubscription: boolean,
  hasRentBuy: boolean,
  daysSinceRelease: number,
): StreamStatus {
  if (origin === "streaming") {
    if (hasSubscription) return "confirmado";
    if (hasRentBuy) return "confirmado";
    if (daysSinceRelease > 365) return "unavailable";
    return "chegando";
  }
  if (daysSinceRelease < 0)  return "cinemas";
  if (daysSinceRelease < 45) return "cinemas";
  if (daysSinceRelease < 90) return hasRentBuy ? "confirmado" : "chegando";
  return hasSubscription || hasRentBuy ? "confirmado" : "unavailable";
}

export function mapLegacyStreamStatus(status: StreamStatus): StreamingAvailabilityStatus {
  switch (status) {
    case "cinemas":
      return "cinema_now";
    case "chegando":
      return "digital_expected";
    case "confirmado":
    case "streaming":
      return "available_subscription";
    case "unavailable":
    default:
      return "unavailable";
  }
}

export function deriveStreamingAvailabilityStatus(opts: {
  accessTypes: StreamingAccessType[];
  availableAbroad: boolean;
  legacyStreamStatus: StreamStatus;
  daysSinceRelease: number;
}): StreamingAvailabilityStatus {
  const { accessTypes, availableAbroad, legacyStreamStatus, daysSinceRelease } = opts;
  if (accessTypes.includes("subscription")) return "available_subscription";
  if (accessTypes.includes("free")) return "available_free";
  if (accessTypes.includes("ads")) return "available_free";
  if (accessTypes.includes("rent")) return "available_rent";
  if (accessTypes.includes("buy")) return "available_buy";
  if (availableAbroad) return "available_abroad";
  if (legacyStreamStatus === "cinemas") return "cinema_now";
  if (daysSinceRelease < 0) return "upcoming";
  if (daysSinceRelease >= 0 && daysSinceRelease < 45) return "recently_released";
  if (legacyStreamStatus === "chegando") return "digital_expected";
  return mapLegacyStreamStatus(legacyStreamStatus);
}

export function calculateStreamingConfidence(opts: {
  providers: StreamingProvider[];
  availableAbroad: boolean;
  inferred: boolean;
  sourceApis: StreamingSourceApi[];
  legacyStreamStatus: StreamStatus;
}): number {
  const { providers, availableAbroad, inferred, sourceApis, legacyStreamStatus } = opts;

  if (sourceApis.includes("movieofthenight") && sourceApis.includes("tmdb")) return 92;
  if (sourceApis.includes("watchmode") && sourceApis.includes("tmdb")) return 85;
  if (providers.length > 0) return 70;
  if (availableAbroad) return 55;
  if (inferred) return legacyStreamStatus === "confirmado" ? 50 : 35;
  if (legacyStreamStatus === "cinemas" || legacyStreamStatus === "chegando") return 30;
  if (legacyStreamStatus === "unavailable") return 20;
  return 10;
}

export function inferStreamingFallback(opts: {
  origin: "cinema" | "streaming";
  releaseDate: string;
  studio: StudioInfo | null;
  hasSubscription: boolean;
  hasRentBuy: boolean;
  mediaType: "movie" | "tv";
}): { inferred: boolean; legacyStreamStatus: StreamStatus; debugNotes: string[] } {
  const { origin, releaseDate, studio, hasSubscription, hasRentBuy, mediaType } = opts;
  const daysSinceRelease = daysBetween(releaseDate);
  const svodWindowPassed =
    !hasSubscription &&
    !hasRentBuy &&
    origin === "cinema" &&
    studio !== null &&
    studio.svodDays > 0 &&
    daysSinceRelease > studio.svodDays;

  if (svodWindowPassed) {
    return {
      inferred: true,
      legacyStreamStatus: "confirmado",
      debugNotes: ["studio_svod_window_inference"],
    };
  }

  return {
    inferred: false,
    legacyStreamStatus: deriveStreamStatus(
      origin,
      releaseDate,
      hasSubscription,
      hasRentBuy,
      daysSinceRelease,
    ),
    debugNotes: mediaType === "tv" ? ["tv_origin_streaming_default"] : [],
  };
}

// ─── Context pool ─────────────────────────────────────────────────────────────

export function buildContextPool(opts: {
  createdAt: string;
  releaseDate: string;
  streamStatus: StreamStatus;
  mediaType: "movie" | "tv";
  seasons: number | null;
  providers: { name: string; type: string }[];
  studio: StudioInfo | null;
  genre: string | null;
  origin: "cinema" | "streaming";
  inferred?: boolean;
}): string[] {
  const { createdAt, releaseDate, streamStatus, mediaType, seasons, providers, studio, origin, inferred } = opts;

  const pool: string[] = [];
  const daysSaved        = daysBetween(createdAt);
  const daysSinceRelease = daysBetween(releaseDate);
  const releaseMonth     = PT_MONTHS[new Date(releaseDate).getMonth()] ?? "";
  const releaseYear      = new Date(releaseDate).getFullYear();
  const thisYear         = new Date().getFullYear();

  const releaseDateLabel =
    releaseYear === thisYear ? `em ${releaseMonth}` : `em ${releaseMonth} de ${releaseYear}`;

  const flatrate = providers.find((p) => p.type === "flatrate");
  const rent     = providers.find((p) => p.type === "rent");
  const buy      = providers.find((p) => p.type === "buy");

  // Caso especial: status inferido por janela SVOD — TMDB sem dados de provider para BR
  if (inferred && studio) {
    const daysSaved = daysBetween(createdAt);
    if (daysSaved > 365) {
      pool.push(`Na lista há mais de um ano · verifique no ${studio.platform}`);
    } else if (daysSaved > 90) {
      pool.push(`Na lista há ${Math.round(daysSaved / 30)} meses · verifique no ${studio.platform}`);
    } else {
      pool.push(`Janela de streaming aberta · verifique no ${studio.platform}`);
    }
    pool.push(`Deve estar no ${studio.platform} · dados de streaming em atualização`);
    return pool;
  }

  if (streamStatus === "cinemas") {
    if (studio) {
      pool.push(
        `Ainda nos cinemas · aluguel digital previsto para ${monthFromNow(releaseDate, studio.pvodDays)}`,
        `Deve chegar ao ${studio.platform} em ${monthFromNow(releaseDate, studio.svodDays)}`,
      );
    } else {
      const weeksLeft = Math.max(1, Math.round((45 - daysSinceRelease) / 7));
      pool.push(
        `Ainda nos cinemas · aluguel digital em ~${weeksLeft} ${weeksLeft === 1 ? "semana" : "semanas"}`,
        "Ainda em cartaz · em breve no streaming",
      );
    }
  } else if (streamStatus === "chegando") {
    if (origin === "streaming") {
      // Conteúdo nativo de streaming ainda indisponível no Brasil
      if (studio) {
        pool.push(
          `Lançamento direto no ${studio.platform} · ainda não chegou ao Brasil`,
          `Produção ${studio.platform} · em breve disponível no BR`,
        );
      } else {
        pool.push(
          "Disponível fora do Brasil · ainda não chegou ao streaming brasileiro",
          "Em breve disponível no streaming brasileiro",
        );
      }
    } else if (studio) {
      // Origem cinema com studio conhecido
      const pvodPassed = daysSinceRelease >= studio.pvodDays;
      const svodMonth  = monthFromNow(releaseDate, studio.svodDays);
      if (pvodPassed) {
        pool.push(
          `Aluguel digital nos EUA · ${studio.platform} previsto para ${svodMonth} no BR`,
          `Já circula digitalmente fora do Brasil · chega ao ${studio.platform} em ${svodMonth}`,
        );
      } else {
        pool.push(
          `Saiu dos cinemas · aluguel digital previsto para ${monthFromNow(releaseDate, studio.pvodDays)}`,
          `Deve chegar ao ${studio.platform} em ${svodMonth}`,
        );
      }
    } else {
      // Origem cinema sem studio mapeado
      const weeksSince = Math.round(daysSinceRelease / 7);
      pool.push(
        `Saiu dos cinemas há ${weeksSince} ${weeksSince === 1 ? "semana" : "semanas"} · janela de streaming se abrindo`,
        "Transição cinema → streaming · em breve disponível",
      );
    }
  } else if (flatrate) {
    if (daysSaved > 365) {
      pool.push(`Lançado ${releaseDateLabel} · na sua lista há mais de um ano`);
    } else if (daysSaved > 90) {
      pool.push(`Na sua lista há ${Math.round(daysSaved / 30)} meses · lançado ${releaseDateLabel}`);
    } else {
      pool.push(`Lançado ${releaseDateLabel}`);
    }
  } else if (rent || buy) {
    pool.push(
      `Disponível para ${rent ? "aluguel" : "compra"} · lançado ${releaseDateLabel}`,
      `Lançado ${releaseDateLabel}`,
    );
  } else if (streamStatus === "unavailable") {
    if (studio) {
      const svodMonth = monthFromNow(releaseDate, studio.svodDays);
      pool.push(
        `Indisponível nos streamings do Brasil · previsto para o ${studio.platform} em ${svodMonth}`,
        `Ainda não chegou ao streaming BR · estimativa: ${studio.platform} em ${svodMonth}`,
      );
    } else {
      pool.push(
        "Indisponível nos streamings do Brasil",
        "Ainda não chegou ao streaming brasileiro",
      );
    }
  } else if (studio?.platform) {
    pool.push(`Produção ${studio.platform}`, `Lançamento direto no ${studio.platform}`);
  } else {
    pool.push("Indisponível nos streamings do Brasil", "Ainda não chegou ao streaming brasileiro");
  }

  if (mediaType === "tv" && seasons) {
    if (seasons >= 5) {
      pool.push(`${seasons} temporadas disponíveis`, `Iniciou em ${releaseDateLabel}`);
    } else if (seasons === 1) {
      pool.push("Primeira e única temporada", `Estreou ${releaseDateLabel}`);
    }
  }

  return pool.length > 0 ? pool : ["Na sua lista"];
}

export const getStreamingContextPool = buildContextPool;

// ─── Main export ──────────────────────────────────────────────────────────────

export async function resolveStreamingAvailability(
  tmdbId: number,
  mediaType: "movie" | "tv",
  opts: StreamingOpts = {},
  country = "BR",
): Promise<StreamingAvailabilityResult> {
  // watch/providers não usa language — passamos null para não filtrar por país de idioma
  if (opts.useCache !== false) {
    const cached = await getCachedStreamingAvailability({ tmdbId, mediaType, country });
    if (cached && !shouldRefreshStreamingAvailability(cached, opts.forceRefresh)) {
      return cached.availability;
    }
  }

  const providersData = await tmdbFetch(`/${mediaType}/${tmdbId}/watch/providers`, {}, 3600, null);

  const countryProviders = normalizeStreamingProviders(providersData, country);
  const categorized = providersByCategory(countryProviders);
  const hasCountryProviders = hasAnyProvider(categorized);

  let availableAbroad = false;
  if (!hasCountryProviders) {
    const us = extractProviders(providersData, "US");
    availableAbroad = hasAnyProvider(us);
  }

  const releaseDate = opts.releaseDate ?? new Date().toISOString().slice(0, 10);
  const createdAt   = opts.createdAt   ?? new Date().toISOString();
  const companies   = opts.productionCompanies ?? [];
  const studio      = getStudioInfo(companies);
  const origin      = deriveOrigin(opts.budget ?? 0, opts.revenue ?? 0, mediaType);

  const hasSubscription = categorized.flatrate.length > 0 || categorized.free.length > 0 || categorized.ads.length > 0;
  const hasRentBuy      = categorized.rent.length > 0 || categorized.buy.length > 0;
  const daysSinceRelease = daysBetween(releaseDate);

  // Inferência por janela SVOD: se o estúdio tem janela conhecida e ela já passou,
  // mas o TMDB não tem dados de provider BR, tratamos como confirmado.
  // Isso acontece porque o TMDB/JustWatch tem dados defasados para o Brasil.
  const fallback = inferStreamingFallback({
    origin,
    releaseDate,
    studio,
    hasSubscription,
    hasRentBuy,
    mediaType,
  });

  const inferred = fallback.inferred;
  const streamStatus = fallback.legacyStreamStatus;

  const providersForContext = [
    ...categorized.flatrate.map((p) => ({ name: p.name, type: "flatrate" as const })),
    ...categorized.free.map((p)     => ({ name: p.name, type: "flatrate" as const })),
    ...categorized.rent.map((p)     => ({ name: p.name, type: "rent"     as const })),
    ...categorized.buy.map((p)      => ({ name: p.name, type: "buy"      as const })),
  ];

  const contextPool = buildContextPool({
    createdAt,
    releaseDate,
    streamStatus,
    mediaType,
    seasons: opts.seasons ?? null,
    providers: providersForContext,
    studio,
    genre: opts.genre ?? null,
    origin,
    inferred,
  });

  const accessTypes = getAccessTypes(countryProviders);
  const sourceApis: StreamingSourceApi[] = inferred ? ["tmdb", "inference"] : ["tmdb"];
  const canonicalStreamStatus = deriveStreamingAvailabilityStatus({
    accessTypes,
    availableAbroad,
    legacyStreamStatus: streamStatus,
    daysSinceRelease,
  });
  const confidenceScore = calculateStreamingConfidence({
    providers: countryProviders,
    availableAbroad,
    inferred,
    sourceApis,
    legacyStreamStatus: streamStatus,
  });

  const availability: StreamingAvailabilityResult = {
    tmdbId,
    mediaType,
    country,
    providers: countryProviders,
    streamStatus: canonicalStreamStatus,
    legacyStreamStatus: streamStatus,
    accessTypes,
    availableInCountry: hasCountryProviders,
    availableAbroad,
    origin,
    estimatedPlatform:    studio?.platform ?? null,
    estimatedMonth:       studio ? monthFromNow(releaseDate, studio.svodDays) : null,
    estimatedPvodMonth:   studio && studio.pvodDays > 0 ? monthFromNow(releaseDate, studio.pvodDays) : null,
    sourceApis,
    confidenceScore,
    inferred,
    contextPool,
    lastCheckedAt: new Date().toISOString(),
    rawProviderData: providersData,
    debugNotes: fallback.debugNotes,
    ...categorized,
  };

  if (opts.useCache !== false) {
    await setCachedStreamingAvailability(availability, { releaseDate });
  }

  return availability;
}

export async function getStreamingInfo(
  tmdbId: number,
  mediaType: "movie" | "tv",
  opts: StreamingOpts = {},
): Promise<StreamingInfo> {
  const availability = await resolveStreamingAvailability(tmdbId, mediaType, opts, "BR");

  return {
    flatrate: availability.flatrate,
    free: availability.free,
    ads: availability.ads,
    rent: availability.rent,
    buy: availability.buy,
    availableAbroad: availability.availableAbroad,
    streamStatus: availability.legacyStreamStatus,
    origin: availability.origin,
    estimatedPlatform: availability.estimatedPlatform,
    estimatedMonth: availability.estimatedMonth,
    estimatedPvodMonth: availability.estimatedPvodMonth,
    inferred: availability.inferred,
    contextPool: availability.contextPool,
    availability,
    providers: availability.providers,
    accessTypes: availability.accessTypes,
    availableInCountry: availability.availableInCountry,
    sourceApis: availability.sourceApis,
    confidenceScore: availability.confidenceScore,
    canonicalStreamStatus: availability.streamStatus,
    lastCheckedAt: availability.lastCheckedAt,
  };
}

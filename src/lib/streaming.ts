// src/lib/streaming.ts
// Utilitário centralizado de providers e status de streaming.
// Consumido pela página de título e pelo /api/watchlist/live.

import { tmdbFetch } from "@/lib/tmdb";

// ─── Types públicos ───────────────────────────────────────────────────────────

export type StreamStatus =
  | "streaming"
  | "chegando"
  | "cinemas"
  | "confirmado"
  | "unavailable";

export type StreamingProvider = {
  id: number;
  name: string;
  logo: string;
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
  contextPool: string[];
};

export type StreamingOpts = {
  releaseDate?: string | null;
  createdAt?: string;
  seasons?: number | null;
  genre?: string | null;
  productionCompanies?: Array<{ id: number; name: string }>;
  budget?: number;
  revenue?: number;
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

function extractProviders(providersData: unknown, region: string): ProvidersByCategory {
  const empty: ProvidersByCategory = { flatrate: [], free: [], ads: [], rent: [], buy: [] };
  if (!providersData || typeof providersData !== "object") return empty;
  const results = (providersData as Record<string, unknown>).results;
  if (!results || typeof results !== "object") return empty;
  const regionData = (results as Record<string, unknown>)[region];
  if (!regionData || typeof regionData !== "object") return empty;
  const regionObj = regionData as Record<string, unknown>;

  function toList(raw: unknown): StreamingProvider[] {
    if (!Array.isArray(raw)) return [];
    return (raw as Record<string, unknown>[]).map((p) => ({
      id:   Number(p.provider_id),
      name: String(p.provider_name ?? ""),
      logo: String(p.logo_path ?? ""),
    }));
  }

  return {
    flatrate: toList(regionObj.flatrate),
    free:     toList(regionObj.free),
    ads:      toList(regionObj.ads),
    rent:     toList(regionObj.rent),
    buy:      toList(regionObj.buy),
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
}): string[] {
  const { createdAt, releaseDate, streamStatus, mediaType, seasons, providers, studio, genre } = opts;

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

  if (genre) pool.push(genre);

  if (streamStatus === "cinemas") {
    if (studio) {
      pool.push(
        `Ainda nos cinemas · aluguel digital previsto para ${monthFromNow(releaseDate, studio.pvodDays)}`,
        `Deve chegar ao ${studio.platform} em ${monthFromNow(releaseDate, studio.svodDays)}`,
      );
    } else {
      const weeksLeft = Math.max(1, Math.round((45 - daysSinceRelease) / 7));
      pool.push(
        `Ainda nos cinemas · streaming em ~${weeksLeft} ${weeksLeft === 1 ? "semana" : "semanas"}`,
        "Ainda em cartaz",
      );
    }
  } else if (streamStatus === "chegando") {
    if (studio) {
      const pvodPassed = daysSinceRelease >= studio.pvodDays;
      const svodMonth  = monthFromNow(releaseDate, studio.svodDays);
      if (pvodPassed) {
        pool.push(
          `Aluguel Digital nos EUA · ${studio.platform} previsto para ${svodMonth} no BR`,
          `Já circula digitalmente fora do Brasil · chega ao ${studio.platform} em ${svodMonth}`,
        );
      } else {
        pool.push(
          `Saiu dos cinemas · aluguel digital previsto para ${monthFromNow(releaseDate, studio.pvodDays)}`,
          `Deve chegar ao ${studio.platform} em ${svodMonth}`,
        );
      }
    } else {
      const weeksSince = Math.round(daysSinceRelease / 7);
      pool.push(
        `Saiu dos cinemas há ${weeksSince} semanas · janela de streaming se abrindo`,
        "Transição cinema → streaming",
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

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getStreamingInfo(
  tmdbId: number,
  mediaType: "movie" | "tv",
  opts: StreamingOpts = {},
): Promise<StreamingInfo> {
  const providersData = await tmdbFetch(`/${mediaType}/${tmdbId}/watch/providers`);

  const br = extractProviders(providersData, "BR");

  const hasBR =
    br.flatrate.length > 0 ||
    br.free.length > 0 ||
    br.ads.length > 0 ||
    br.rent.length > 0 ||
    br.buy.length > 0;

  let availableAbroad = false;
  if (!hasBR) {
    const us = extractProviders(providersData, "US");
    availableAbroad =
      us.flatrate.length > 0 ||
      us.free.length > 0 ||
      us.ads.length > 0 ||
      us.rent.length > 0 ||
      us.buy.length > 0;
  }

  const releaseDate = opts.releaseDate ?? new Date().toISOString().slice(0, 10);
  const createdAt   = opts.createdAt   ?? new Date().toISOString();
  const companies   = opts.productionCompanies ?? [];
  const studio      = getStudioInfo(companies);
  const origin      = deriveOrigin(opts.budget ?? 0, opts.revenue ?? 0, mediaType);

  const hasSubscription = br.flatrate.length > 0 || br.free.length > 0;
  const hasRentBuy      = br.rent.length > 0 || br.buy.length > 0;
  const daysSinceRelease = daysBetween(releaseDate);

  const streamStatus = deriveStreamStatus(
    origin, releaseDate, hasSubscription, hasRentBuy, daysSinceRelease,
  );

  const providersForContext = [
    ...br.flatrate.map((p) => ({ name: p.name, type: "flatrate" as const })),
    ...br.free.map((p)     => ({ name: p.name, type: "flatrate" as const })),
    ...br.rent.map((p)     => ({ name: p.name, type: "rent"     as const })),
    ...br.buy.map((p)      => ({ name: p.name, type: "buy"      as const })),
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
  });

  return {
    ...br,
    availableAbroad,
    streamStatus,
    origin,
    estimatedPlatform: studio?.platform ?? null,
    estimatedMonth:    studio ? monthFromNow(releaseDate, studio.svodDays) : null,
    contextPool,
  };
}

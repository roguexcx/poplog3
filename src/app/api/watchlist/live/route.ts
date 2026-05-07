// src/app/api/watchlist/live/route.ts

import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";

// ─── Types ────────────────────────────────────────────────────────────────────

type StreamStatus =
  | "streaming"
  | "chegando"
  | "cinemas"
  | "confirmado"
  | "unavailable";

type RawTitle = {
  id: number;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  release_year: number | null;
  created_at: string;
  fridge: boolean;
  stream_status: StreamStatus | null;
  stream_status_checked_at: string | null;
};

type Provider = {
  provider_id: number;
  provider_name: string;
  logo_path: string;
};

type EnrichedTitle = {
  id: number;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_path: string | null;
  year: string | null;
  genre: string | null;
  runtime: number | null;
  runtime_label: string | null;
  seasons: number | null;
  origin: "cinema" | "streaming";
  release_date: string;
  created_at: string;
  stream_status: StreamStatus;
  providers: { name: string; logo: string; type: "flatrate" | "rent" | "buy" }[];
  estimated_platform: string | null;
  estimated_month: string | null;
  context_pool: string[];
  fridge: boolean;
  stream_status_updated: boolean;
};

type TMDBDetails = Record<string, unknown> & {
  id?: number;
  title?: string;
  name?: string;
  poster_path?: string | null;

  release_date?: string | null;
  first_air_date?: string | null;

  runtime?: number | null;
  episode_run_time?: number[] | null;
  number_of_seasons?: number | null;

  genres?: Array<{ id: number; name: string }>;
  production_companies?: Array<{ id: number; name: string }>;

  revenue?: number;
  budget?: number;
};

// ─── Estúdio → janelas ────────────────────────────────────────────────────────

type StudioInfo = {
  platform: string;
  svodDays: number;
  pvodDays: number;
};

const STUDIO_MAP: Record<string, StudioInfo> = {
  "Walt Disney Pictures": { platform: "Disney+", svodDays: 105, pvodDays: 45 },
  "Walt Disney Animation": { platform: "Disney+", svodDays: 100, pvodDays: 45 },
  Pixar: { platform: "Disney+", svodDays: 100, pvodDays: 45 },
  "Marvel Studios": { platform: "Disney+", svodDays: 95, pvodDays: 45 },
  Lucasfilm: { platform: "Disney+", svodDays: 95, pvodDays: 45 },
  "Searchlight Pictures": { platform: "Disney+", svodDays: 110, pvodDays: 45 },
  "20th Century Studios": { platform: "Disney+", svodDays: 105, pvodDays: 45 },
  "20th Century Fox": { platform: "Disney+", svodDays: 105, pvodDays: 45 },

  "Warner Bros. Pictures": { platform: "Max", svodDays: 60, pvodDays: 45 },
  "New Line Cinema": { platform: "Max", svodDays: 60, pvodDays: 45 },
  "DC Studios": { platform: "Max", svodDays: 60, pvodDays: 45 },

  "Universal Pictures": { platform: "Peacock", svodDays: 55, pvodDays: 35 },
  "DreamWorks Animation": { platform: "Peacock", svodDays: 60, pvodDays: 38 },
  "Amblin Entertainment": { platform: "Peacock", svodDays: 60, pvodDays: 38 },
  "Focus Features": { platform: "streaming", svodDays: 45, pvodDays: 17 },

  "Columbia Pictures": { platform: "Netflix", svodDays: 75, pvodDays: 38 },
  "Sony Pictures": { platform: "Netflix", svodDays: 75, pvodDays: 38 },
  "TriStar Pictures": { platform: "Netflix", svodDays: 75, pvodDays: 38 },
  "Screen Gems": { platform: "Netflix", svodDays: 75, pvodDays: 38 },

  "Paramount Pictures": { platform: "Paramount+", svodDays: 65, pvodDays: 45 },
  "Paramount Animation": { platform: "Paramount+", svodDays: 65, pvodDays: 45 },

  A24: { platform: "MUBI", svodDays: 120, pvodDays: 21 },

  Neon: { platform: "streaming", svodDays: 60, pvodDays: 30 },
  "Apple Original Films": { platform: "Apple TV+", svodDays: 0, pvodDays: 0 },
  "Amazon MGM Studios": { platform: "Prime Video", svodDays: 0, pvodDays: 0 },
  Netflix: { platform: "Netflix", svodDays: 0, pvodDays: 0 },
};

function getStudioInfo(companies: Array<{ id: number; name: string }>): StudioInfo | null {
  for (const company of companies) {
    const match = STUDIO_MAP[company.name];

    if (match) {
      return match;
    }

    for (const [key, value] of Object.entries(STUDIO_MAP)) {
      if (company.name.includes(key) || key.includes(company.name)) {
        return value;
      }
    }
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PT_MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function daysBetween(a: string, b: string = new Date().toISOString()): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function monthFromNow(releaseDate: string, days: number): string {
  const date = new Date(releaseDate);
  date.setDate(date.getDate() + days);

  return PT_MONTHS[date.getMonth()] ?? "";
}

// ─── Validação cruzada de ID ──────────────────────────────────────────────────

type IdValidation =
  | { ok: true }
  | { ok: false; reason: "id_mismatch" | "upcoming" | "no_release_date" };

function validateTmdbId(
  tmdbReleaseDate: string | null,
  rowReleaseYear: number | null,
): IdValidation {
  if (!tmdbReleaseDate) {
    return { ok: false, reason: "no_release_date" };
  }

  const tmdbYear = new Date(tmdbReleaseDate).getFullYear();
  const today = new Date();

  if (new Date(tmdbReleaseDate) > today) {
    return { ok: false, reason: "upcoming" };
  }

  if (rowReleaseYear && Math.abs(tmdbYear - rowReleaseYear) > 3) {
    return { ok: false, reason: "id_mismatch" };
  }

  return { ok: true };
}

function deriveOrigin(
  details: Record<string, unknown>,
  mediaType: "movie" | "tv",
): "cinema" | "streaming" {
  if (mediaType === "tv") {
    return "streaming";
  }

  const revenue = (details.revenue as number) ?? 0;
  const budget = (details.budget as number) ?? 0;

  if (revenue > 50_000 || budget > 100_000) {
    return "cinema";
  }

  return "streaming";
}

function deriveStreamStatus(
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

  if (daysSinceRelease < 0) return "cinemas";
  if (daysSinceRelease < 45) return "cinemas";
  if (daysSinceRelease < 90) return hasRentBuy ? "confirmado" : "chegando";

  return hasSubscription || hasRentBuy ? "confirmado" : "unavailable";
}

function isStale(checkedAt: string | null, releaseDate: string): boolean {
  if (!checkedAt) {
    return true;
  }

  const daysSinceRelease = daysBetween(releaseDate);
  const daysSinceCheck = daysBetween(checkedAt);

  if (daysSinceRelease >= 45 && daysSinceRelease <= 90) {
    return daysSinceCheck >= 3;
  }

  return daysSinceCheck >= 7;
}

function formatRuntime(minutes: number | null): string | null {
  if (!minutes) {
    return null;
  }

  if (minutes < 60) {
    return `${minutes}min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0 ? `${hours}h${remainingMinutes}min` : `${hours}h`;
}

// ─── Context pool ─────────────────────────────────────────────────────────────

function buildContextPool(opts: {
  createdAt: string;
  releaseDate: string;
  streamStatus: StreamStatus;
  mediaType: "movie" | "tv";
  seasons: number | null;
  providers: { name: string; type: string }[];
  studio: StudioInfo | null;
  genre: string | null;
}): string[] {
  const {
    createdAt,
    releaseDate,
    streamStatus,
    mediaType,
    seasons,
    providers,
    studio,
    genre,
  } = opts;

  const pool: string[] = [];
  const daysSaved = daysBetween(createdAt);
  const daysSinceRelease = daysBetween(releaseDate);
  const releaseMonth = PT_MONTHS[new Date(releaseDate).getMonth()] ?? "";
  const releaseYear = new Date(releaseDate).getFullYear();
  const thisYear = new Date().getFullYear();

  const releaseDateLabel =
    releaseYear === thisYear
      ? `em ${releaseMonth}`
      : `em ${releaseMonth} de ${releaseYear}`;

  const flatrate = providers.find((provider) => provider.type === "flatrate");
  const rent = providers.find((provider) => provider.type === "rent");
  const buy = providers.find((provider) => provider.type === "buy");

  if (genre) {
    pool.push(genre);
  }

  if (streamStatus === "cinemas") {
    if (studio) {
      const pvodMonth = monthFromNow(releaseDate, studio.pvodDays);
      const svodMonth = monthFromNow(releaseDate, studio.svodDays);

      pool.push(
        `Ainda nos cinemas · aluguel digital previsto para ${pvodMonth}`,
        `Deve chegar ao ${studio.platform} em ${svodMonth}`,
      );
    } else {
      const weeksLeft = Math.max(1, Math.round((45 - daysSinceRelease) / 7));

      pool.push(
        `Ainda nos cinemas · streaming em ~${weeksLeft} ${
          weeksLeft === 1 ? "semana" : "semanas"
        }`,
        "Ainda em cartaz",
      );
    }
  } else if (streamStatus === "chegando") {
    if (studio) {
      const pvodPassed = daysSinceRelease >= studio.pvodDays;
      const svodMonth = monthFromNow(releaseDate, studio.svodDays);

      if (pvodPassed) {
        pool.push(
          `Aluguel Digital nos EUA · ${studio.platform} previsto para ${svodMonth} no BR`,
          `Já circula digitalmente fora do Brasil · chega ao ${studio.platform} em ${svodMonth}`,
        );
      } else {
        const pvodMonth = monthFromNow(releaseDate, studio.pvodDays);

        pool.push(
          `Saiu dos cinemas · aluguel digital previsto para ${pvodMonth}`,
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
      pool.push(
        `Na sua lista há ${Math.round(daysSaved / 30)} meses · lançado ${releaseDateLabel}`,
      );
    } else {
      pool.push(`Lançado ${releaseDateLabel}`);
    }
  } else if (rent || buy) {
    const type = rent ? "aluguel" : "compra";

    pool.push(
      `Disponível para ${type} · lançado ${releaseDateLabel}`,
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

// ─── Extrai providers BR ──────────────────────────────────────────────────────

function extractProvidersBR(providersData: unknown): {
  flatrate: Provider[];
  rent: Provider[];
  buy: Provider[];
} {
  const empty = { flatrate: [], rent: [], buy: [] };

  if (!providersData || typeof providersData !== "object") {
    return empty;
  }

  const results = (providersData as Record<string, unknown>).results;

  if (!results || typeof results !== "object") {
    return empty;
  }

  const br = (results as Record<string, unknown>).BR;

  if (!br || typeof br !== "object") {
    return empty;
  }

  const brObj = br as Record<string, unknown>;

  function toList(raw: unknown): Provider[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map((provider) => {
      const item = provider as Record<string, unknown>;

      return {
        provider_id: Number(item.provider_id),
        provider_name: String(item.provider_name ?? ""),
        logo_path: String(item.logo_path ?? ""),
      };
    });
  }

  return {
    flatrate: toList(brObj.flatrate),
    rent: toList(brObj.rent),
    buy: toList(brObj.buy),
  };
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const { titles } = await request.json();

    if (!Array.isArray(titles) || titles.length === 0) {
      return NextResponse.json({ titles: [] });
    }

    const rows = titles as RawTitle[];

    const enriched = await Promise.all(
      rows.map(async (row): Promise<EnrichedTitle | null> => {
        try {
          const endpoint = `/${row.media_type}/${row.tmdb_id}`;
          const fallbackRelease = `${row.release_year ?? new Date().getFullYear()}-01-01`;
          const needsCheck = isStale(row.stream_status_checked_at, fallbackRelease);

          const [details, providersData] = await Promise.all([
            tmdbFetch<TMDBDetails>(endpoint, {
              append_to_response: "genres,production_companies",
            }),
            tmdbFetch(`${endpoint}/watch/providers`),
          ]);

          const tmdbReleaseDate =
            details.release_date ?? details.first_air_date ?? null;

          const releaseDate: string = tmdbReleaseDate ?? fallbackRelease;

          const idCheck = validateTmdbId(tmdbReleaseDate, row.release_year);

          if (!idCheck.ok) {
            const genre = details.genres?.[0]?.name ?? null;
            const safeContext =
              idCheck.reason === "id_mismatch"
                ? ["Aguardando confirmação de data", "Lançamento previsto"]
                : [
                    `Estreia prevista para ${
                      PT_MONTHS[new Date(releaseDate).getMonth()] ?? ""
                    }`,
                    "Salvo antes de estrear · ainda não lançou",
                  ];

            return {
              id: row.id,
              tmdb_id: row.tmdb_id,
              media_type: row.media_type,
              title: details.title ?? details.name ?? row.title,
              poster_path: details.poster_path ?? null,
              year: row.release_year ? String(row.release_year) : null,
              genre,
              runtime: null,
              runtime_label: null,
              seasons: null,
              origin: "cinema",
              release_date: releaseDate,
              created_at: row.created_at,
              stream_status: "cinemas",
              providers: [],
              estimated_platform: null,
              estimated_month: null,
              context_pool: safeContext,
              fridge: row.fridge ?? false,
              stream_status_updated: false,
            };
          }

          const origin = deriveOrigin(details, row.media_type);
          const { flatrate, rent, buy } = extractProvidersBR(providersData);

          const hasSubscription = flatrate.length > 0;
          const hasRentBuy = rent.length > 0 || buy.length > 0;

          const seenIds = new Set<number>();
          const providers: EnrichedTitle["providers"] = [];

          for (const [list, type] of [
            [flatrate, "flatrate"],
            [rent, "rent"],
            [buy, "buy"],
          ] as const) {
            for (const provider of list) {
              if (!seenIds.has(provider.provider_id)) {
                seenIds.add(provider.provider_id);
                providers.push({
                  name: provider.provider_name,
                  logo: provider.logo_path,
                  type,
                });
              }
            }
          }

          const companies = details.production_companies ?? [];
          const studio = getStudioInfo(companies);

          const daysSinceRelease = daysBetween(releaseDate);
          const streamStatus = deriveStreamStatus(
            origin,
            releaseDate,
            hasSubscription,
            hasRentBuy,
            daysSinceRelease,
          );

          const rawRuntime =
            details.runtime ?? details.episode_run_time?.[0] ?? null;

          const seasons =
            row.media_type === "tv" ? details.number_of_seasons ?? null : null;

          const genre = details.genres?.[0]?.name ?? null;

          const contextPool = buildContextPool({
            createdAt: row.created_at,
            releaseDate,
            streamStatus,
            mediaType: row.media_type,
            seasons,
            providers,
            studio,
            genre,
          });

          return {
            id: row.id,
            tmdb_id: row.tmdb_id,
            media_type: row.media_type,
            title: details.title ?? details.name ?? row.title,
            poster_path: details.poster_path ?? null,
            year: releaseDate ? String(new Date(releaseDate).getFullYear()) : null,
            genre,
            runtime: rawRuntime,
            runtime_label: formatRuntime(rawRuntime),
            seasons,
            origin,
            release_date: releaseDate,
            created_at: row.created_at,
            stream_status: streamStatus,
            providers,
            estimated_platform: studio?.platform ?? null,
            estimated_month: studio ? monthFromNow(releaseDate, studio.svodDays) : null,
            context_pool: contextPool,
            fridge: row.fridge ?? false,
            stream_status_updated: needsCheck,
          };
        } catch {
          return null;
        }
      }),
    );

    return NextResponse.json({
      titles: enriched.filter(Boolean) as EnrichedTitle[],
    });
  } catch {
    return NextResponse.json({ titles: [] }, { status: 200 });
  }
}
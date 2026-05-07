// src/app/api/watchlist/live/route.ts

import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";

// ─── Types ────────────────────────────────────────────────────────────────────

type StreamStatus = "streaming" | "chegando" | "cinemas" | "confirmado" | "unavailable";

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

// ─── Estúdio → janelas ────────────────────────────────────────────────────────
// pvodDays = dias cinema → compra/aluguel digital (inclusive fora do BR)
// svodDays = dias cinema → streaming por assinatura no Brasil

type StudioInfo = {
  platform: string;   // SVOD destino provável
  svodDays: number;   // média dias até SVOD BR
  pvodDays: number;   // média dias até PVOD (compra/aluguel digital)
};

const STUDIO_MAP: Record<string, StudioInfo> = {
  // Disney / Fox / Searchlight — 45 dias cinema → PVOD, ~90-110 dias → Disney+
  "Walt Disney Pictures":   { platform: "Disney+",    svodDays: 105, pvodDays: 45 },
  "Walt Disney Animation":  { platform: "Disney+",    svodDays: 100, pvodDays: 45 },
  "Pixar":                  { platform: "Disney+",    svodDays: 100, pvodDays: 45 },
  "Marvel Studios":         { platform: "Disney+",    svodDays: 95,  pvodDays: 45 },
  "Lucasfilm":              { platform: "Disney+",    svodDays: 95,  pvodDays: 45 },
  "Searchlight Pictures":   { platform: "Disney+",    svodDays: 110, pvodDays: 45 },
  "20th Century Studios":   { platform: "Disney+",    svodDays: 105, pvodDays: 45 },
  "20th Century Fox":       { platform: "Disney+",    svodDays: 105, pvodDays: 45 },

  // Warner Bros — 45 dias padrão, até 60-90 em filmes grandes
  "Warner Bros. Pictures":  { platform: "Max",        svodDays: 60,  pvodDays: 45 },
  "New Line Cinema":        { platform: "Max",        svodDays: 60,  pvodDays: 45 },
  "DC Studios":             { platform: "Max",        svodDays: 60,  pvodDays: 45 },

  // Universal — 35 dias PVOD (menor da indústria); SVOD ~55 dias
  "Universal Pictures":     { platform: "Peacock",    svodDays: 55,  pvodDays: 35 },
  "DreamWorks Animation":   { platform: "Peacock",    svodDays: 60,  pvodDays: 38 },
  "Amblin Entertainment":   { platform: "Peacock",    svodDays: 60,  pvodDays: 38 },
  "Focus Features":         { platform: "streaming",  svodDays: 45,  pvodDays: 17 },

  // Sony — 31-45 dias PVOD; SVOD via contrato Netflix
  "Columbia Pictures":      { platform: "Netflix",    svodDays: 75,  pvodDays: 38 },
  "Sony Pictures":          { platform: "Netflix",    svodDays: 75,  pvodDays: 38 },
  "TriStar Pictures":       { platform: "Netflix",    svodDays: 75,  pvodDays: 38 },
  "Screen Gems":            { platform: "Netflix",    svodDays: 75,  pvodDays: 38 },

  // Paramount — 45 dias padrão, até 60-90 conforme bilheteria
  "Paramount Pictures":     { platform: "Paramount+", svodDays: 65,  pvodDays: 45 },
  "Paramount Animation":    { platform: "Paramount+", svodDays: 65,  pvodDays: 45 },

  // A24 — PVOD agressivo (2-4 semanas); SVOD meses depois via MUBI/Prime
  "A24":                    { platform: "MUBI",       svodDays: 120, pvodDays: 21 },

  // Indie / direto ao streaming
  "Neon":                   { platform: "streaming",  svodDays: 60,  pvodDays: 30 },
  "Apple Original Films":   { platform: "Apple TV+",  svodDays: 0,   pvodDays: 0  },
  "Amazon MGM Studios":     { platform: "Prime Video",svodDays: 0,   pvodDays: 0  },
  "Netflix":                { platform: "Netflix",    svodDays: 0,   pvodDays: 0  },
};

function getStudioInfo(companies: Array<{ id: number; name: string }>): StudioInfo | null {
  for (const company of companies) {
    const match = STUDIO_MAP[company.name];
    if (match) return match;
    for (const [key, val] of Object.entries(STUDIO_MAP)) {
      if (company.name.includes(key) || key.includes(company.name)) return val;
    }
  }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PT_MONTHS = [
  "janeiro","fevereiro","março","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro",
];

function daysBetween(a: string, b: string = new Date().toISOString()): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function monthFromNow(releaseDate: string, days: number): string {
  const d = new Date(releaseDate);
  d.setDate(d.getDate() + days);
  return PT_MONTHS[d.getMonth()];
}

// ─── Validação cruzada de ID ──────────────────────────────────────────────────
// Detecta quando o TMDB retornou dados de um filme diferente do que o usuário salvou.
// Situações cobertas:
//   1. release_date do TMDB é muito anterior ao release_year salvo no banco (ID antigo/errado)
//   2. release_date do TMDB é futura → pré-lançamento real
//   3. release_year do banco é atual/futuro mas TMDB retorna filme antigo homônimo

type IdValidation =
  | { ok: true }
  | { ok: false; reason: "id_mismatch" | "upcoming" | "no_release_date" };

function validateTmdbId(
  tmdbReleaseDate: string | null,
  rowReleaseYear: number | null,
): IdValidation {
  // Sem data no TMDB → não conseguimos calcular nada confiável
  if (!tmdbReleaseDate) return { ok: false, reason: "no_release_date" };

  const tmdbYear = new Date(tmdbReleaseDate).getFullYear();
  const today    = new Date();

  // Filme ainda não lançou → pré-lançamento legítimo
  if (new Date(tmdbReleaseDate) > today) return { ok: false, reason: "upcoming" };

  // Se o banco tem release_year e o TMDB retornou algo com ano muito diferente
  // (> 3 anos de diferença) → provável ID errado (sequência com mesmo nome)
  if (rowReleaseYear && Math.abs(tmdbYear - rowReleaseYear) > 3) {
    return { ok: false, reason: "id_mismatch" };
  }

  return { ok: true };
}

function deriveOrigin(
  details: Record<string, unknown>,
  mediaType: "movie" | "tv",
): "cinema" | "streaming" {
  // Séries nunca passam por cinema — sempre streaming/TV
  if (mediaType === "tv") return "streaming";

  // Filmes: presença de receita/orçamento significativo indica lançamento cinematográfico
  const revenue = (details.revenue as number) ?? 0;
  const budget  = (details.budget  as number) ?? 0;
  if (revenue > 50_000 || budget > 100_000) return "cinema";

  // Filmes sem dados financeiros: verifica se tem registro em watch/providers
  // Se não tiver providers E não tiver dados financeiros → provavelmente direto ao streaming
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
    // Tem provider confirmado → confirmado
    if (hasSubscription) return "confirmado";
    if (hasRentBuy)      return "confirmado";
    // Sem provider: se é antigo (> 1 ano) e sem dados → indisponível no BR
    // Se é recente → pode ainda estar chegando
    if (daysSinceRelease > 365) return "unavailable";
    return "chegando";
  }
  const days = daysSinceRelease;
  if (days < 0)   return "cinemas";
  if (days < 45)  return "cinemas";
  if (days < 90)  return hasRentBuy ? "confirmado" : "chegando";
  return hasSubscription || hasRentBuy ? "confirmado" : "unavailable";
}

function isStale(checkedAt: string | null, releaseDate: string): boolean {
  if (!checkedAt) return true;
  const daysSinceRelease = daysBetween(releaseDate);
  const daysSinceCheck   = daysBetween(checkedAt);
  if (daysSinceRelease >= 45 && daysSinceRelease <= 90) return daysSinceCheck >= 3;
  return daysSinceCheck >= 7;
}

function formatRuntime(minutes: number | null): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
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
  const { createdAt, releaseDate, streamStatus, mediaType, seasons, providers, studio, genre } = opts;

  const daysSaved        = daysBetween(createdAt);
  const daysSinceRelease = daysBetween(releaseDate);
  const releaseMonth     = PT_MONTHS[new Date(releaseDate).getMonth()];
  const releaseYear      = new Date(releaseDate).getFullYear();
  const thisYear         = new Date().getFullYear();
  const releaseDateLabel = releaseYear === thisYear
    ? `em ${releaseMonth}`
    : `em ${releaseMonth} de ${releaseYear}`;

  const flatrate    = providers.find((p) => p.type === "flatrate");
  const rent        = providers.find((p) => p.type === "rent");
  const buy         = providers.find((p) => p.type === "buy");

  const pool: string[] = [];

  // ── 1. Relação salvo × lançamento ────────────────────────────────────────
  if (daysSinceRelease < 0) {
    const daysLeft = Math.abs(daysSinceRelease);
    if (daysLeft <= 7)
      pool.push("Estreia essa semana · você estava esperando", "Salvo antes de estrear · já chegou a hora");
    else
      pool.push(`Estreia ${releaseDateLabel} · salvo antes do lançamento`, "Você apostou antes de estrear");
  } else if (daysSaved <= 7 && daysSinceRelease <= 14) {
    pool.push(`Adicionado logo após estrear ${releaseDateLabel}`, "Você foi rápido · ainda fresquinho");
  } else if (daysSaved <= 14) {
    pool.push(`Salvo recentemente · lançado ${releaseDateLabel}`, "Ainda novo na sua lista");
  } else if (daysSaved > 365) {
    pool.push(
      `Na sua lista há mais de um ano · lançado ${releaseDateLabel}`,
      `Você salvou ${releaseDateLabel} e ainda não viu`,
    );
  } else if (daysSaved > 180) {
    const months = Math.round(daysSaved / 30);
    pool.push(
      `Na lista há ${months} meses · lançado ${releaseDateLabel}`,
      `Salvo ${releaseDateLabel} · esperando há muito tempo`,
    );
  } else if (daysSaved > 60) {
    const months = Math.round(daysSaved / 30);
    pool.push(
      `Na lista há ~${months} meses · lançado ${releaseDateLabel}`,
      `Salvo ${releaseDateLabel}`,
    );
  } else {
    pool.push(`Salvo há ${daysSaved} dias · lançado ${releaseDateLabel}`, `Lançado ${releaseDateLabel}`);
  }

  // ── 2. Disponibilidade ────────────────────────────────────────────────────
  if (streamStatus === "cinemas") {
    if (daysSinceRelease < 0) {
      // já coberto acima
    } else if (studio && studio.pvodDays > 0) {
      const pvodMonth = monthFromNow(releaseDate, studio.pvodDays);
      const svodMonth = monthFromNow(releaseDate, studio.svodDays);
      pool.push(
        `Ainda nos cinemas · aluguel digital previsto para ${pvodMonth}`,
        `Deve chegar ao ${studio.platform} em ${svodMonth}`,
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
        // PVOD já passou → deve estar disponível para compra/aluguel (fora do BR oficialmente)
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
    // Badge já mostra a plataforma — texto traz contexto de data/tempo
    if (daysSaved > 365)
      pool.push(`Lançado ${releaseDateLabel} · na sua lista há mais de um ano`);
    else if (daysSaved > 90)
      pool.push(`Na sua lista há ${Math.round(daysSaved / 30)} meses · lançado ${releaseDateLabel}`);
    else
      pool.push(`Lançado ${releaseDateLabel}`);
  } else if (rent || buy) {
    // Badge já mostra plataforma — texto traz data
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
  } else {
    // streaming direto sem provider confirmado
    if (studio?.platform) {
      pool.push(`Produção ${studio.platform}`, `Lançamento direto no ${studio.platform}`);
    } else {
      pool.push("Indisponível nos streamings do Brasil", "Ainda não chegou ao streaming brasileiro");
    }
  }

  // ── 3. Contexto de gênero / série ─────────────────────────────────────────
  if (mediaType === "tv" && seasons) {
    if (seasons >= 5)
      pool.push(`${seasons} temporadas disponíveis`, `Iniciou em ${releaseDateLabel}`);
    else if (seasons === 1)
      pool.push("Primeira e única temporada", `Estreou ${releaseDateLabel}`);
  }

  return pool;
}

// ─── Extrai providers BR ──────────────────────────────────────────────────────

function extractProvidersBR(providersData: unknown): {
  flatrate: Provider[]; rent: Provider[]; buy: Provider[];
} {
  const empty = { flatrate: [], rent: [], buy: [] };
  if (!providersData || typeof providersData !== "object") return empty;
  const results = (providersData as Record<string, unknown>).results;
  if (!results || typeof results !== "object") return empty;
  const br = (results as Record<string, unknown>).BR;
  if (!br || typeof br !== "object") return empty;
  const brObj = br as Record<string, unknown>;

  function toList(raw: unknown): Provider[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((p: Record<string, unknown>) => ({
      provider_id:   Number(p.provider_id),
      provider_name: String(p.provider_name ?? ""),
      logo_path:     String(p.logo_path ?? ""),
    }));
  }

  return { flatrate: toList(brObj.flatrate), rent: toList(brObj.rent), buy: toList(brObj.buy) };
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
          const endpoint        = `/${row.media_type}/${row.tmdb_id}`;
          const fallbackRelease = `${row.release_year ?? new Date().getFullYear()}-01-01`;
          const needsCheck      = isStale(row.stream_status_checked_at, fallbackRelease);

          const [details, providersData] = await Promise.all([
            tmdbFetch(endpoint, { append_to_response: "genres,production_companies" }),
            tmdbFetch(`${endpoint}/watch/providers`),
          ]);

          const tmdbReleaseDate =
            (details.release_date as string | null) ??
            (details.first_air_date as string | null) ??
            null;

          const releaseDate: string = tmdbReleaseDate ?? fallbackRelease;

          // Valida se o TMDB ID bate com o que o usuário salvou
          const idCheck = validateTmdbId(tmdbReleaseDate, row.release_year);

          // ID errado ou pré-lançamento → não calcular janelas, retornar estado seguro
          if (!idCheck.ok) {
            const genre      = (details.genres as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
            const safeContext = idCheck.reason === "id_mismatch"
              ? ["Aguardando confirmação de data", "Lançamento previsto"]
              : [
                  `Estreia prevista para ${PT_MONTHS[new Date(releaseDate).getMonth()]}`,
                  "Salvo antes de estrear · ainda não lançou",
                ];
            return {
              id:                  row.id,
              tmdb_id:             row.tmdb_id,
              media_type:          row.media_type,
              title:               (details.title as string) ?? (details.name as string) ?? row.title,
              poster_path:         (details.poster_path as string | null) ?? null,
              year:                row.release_year ? String(row.release_year) : null,
              genre,
              runtime:             null,
              runtime_label:       null,
              seasons:             null,
              origin:              "cinema" as const,
              release_date:        releaseDate,
              created_at:          row.created_at,
              stream_status:       "cinemas" as StreamStatus,
              providers:           [],
              estimated_platform:  null,
              estimated_month:     null,
              context_pool:        safeContext,
              fridge:              row.fridge ?? false,
              stream_status_updated: false,
            };
          }

          const origin  = deriveOrigin(details as Record<string, unknown>, row.media_type);
          const { flatrate, rent, buy } = extractProvidersBR(providersData);

          const hasSubscription = flatrate.length > 0;
          const hasRentBuy      = rent.length > 0 || buy.length > 0;

          // Lista deduplicada: flatrate → rent → buy
          const seenIds  = new Set<number>();
          const providers: EnrichedTitle["providers"] = [];
          for (const [list, type] of [[flatrate, "flatrate"], [rent, "rent"], [buy, "buy"]] as const) {
            for (const p of list) {
              if (!seenIds.has(p.provider_id)) {
                seenIds.add(p.provider_id);
                providers.push({ name: p.provider_name, logo: p.logo_path, type });
              }
            }
          }

          const companies = (details.production_companies as Array<{ id: number; name: string }>) ?? [];
          const studio    = getStudioInfo(companies);

          const daysSinceRelease = daysBetween(releaseDate);
          const streamStatus = deriveStreamStatus(origin, releaseDate, hasSubscription, hasRentBuy, daysSinceRelease);

          const rawRuntime: number | null =
            (details.runtime as number | undefined) ??
            ((details.episode_run_time as number[] | undefined)?.[0]) ??
            null;

          const seasons: number | null =
            row.media_type === "tv"
              ? (details.number_of_seasons as number | undefined) ?? null
              : null;

          const genres = details.genres as Array<{ id: number; name: string }> | undefined;
          const genre  = genres?.[0]?.name ?? null;

          const contextPool = buildContextPool({
            createdAt:    row.created_at,
            releaseDate,
            streamStatus,
            mediaType:    row.media_type,
            seasons,
            providers,
            studio,
            genre,
          });

          return {
            id:                  row.id,
            tmdb_id:             row.tmdb_id,
            media_type:          row.media_type,
            title:               (details.title as string) ?? (details.name as string) ?? row.title,
            poster_path:         (details.poster_path as string | null) ?? null,
            year:                releaseDate ? String(new Date(releaseDate).getFullYear()) : null,
            genre,
            runtime:             rawRuntime,
            runtime_label:       formatRuntime(rawRuntime),
            seasons,
            origin,
            release_date:        releaseDate,
            created_at:          row.created_at,
            stream_status:       streamStatus,
            providers,
            estimated_platform:  studio?.platform ?? null,
            estimated_month:     studio ? monthFromNow(releaseDate, studio.svodDays) : null,
            context_pool:        contextPool,
            fridge:              row.fridge ?? false,
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
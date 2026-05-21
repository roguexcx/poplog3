// ── ICS Enricher ───────────────────────────────────────────────────────────────
// Enriquece grupos de série com dados TMDB.
//
// Regras:
//   - Uma request TMDB por série-mãe (nunca por episódio)
//   - Concorrência controlada via p-limit (CONCURRENCY_LIMIT simultâneas)
//   - Máx 15 req/s (throttle global entre requests individuais)
//   - Retry automático em 429/5xx: pausa 5s, tenta até MAX_RETRIES vezes
//   - Resultado reaproveitado para todos os episódios do grupo
// ──────────────────────────────────────────────────────────────────────────────

import pLimit from "p-limit";
import type { IcsSeriesGroup, TmdbEnrichment } from "./ics-engine";
import { refineCategoryFromTmdb } from "./ics-engine";

// ── Configuração de rate limit ────────────────────────────────────────────────

// Número máximo de enriquecimentos acontecendo em paralelo.
// Cada enriquecimento faz 3 requests ao TMDB (search + details + images),
// portanto CONCURRENCY_LIMIT=5 → até 15 req em voo simultâneo — dentro do
// limite de 40 req/s da API read da TMDB e bem abaixo do risco de rate-limit.
const CONCURRENCY_LIMIT     = 5;
// Mantidas para retrocompatibilidade com enrichTopGroups (não usado no pipeline principal)
const DEFAULT_BATCH_SIZE    = 10;
const BATCH_PAUSE_MS        = 700;
const MAX_RPS               = 15;
const MIN_REQUEST_INTERVAL  = Math.ceil(1000 / MAX_RPS); // ~67ms
const RETRY_PAUSE_MS        = 5000;
const MAX_RETRIES           = 2;

// ── Helpers de controle ───────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastRequestAt = 0;

async function throttledFetch(url: string, opts?: RequestInit): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await sleep(MIN_REQUEST_INTERVAL - elapsed);
  }
  lastRequestAt = Date.now();
  return fetch(url, opts);
}

// ── Busca TMDB: /search/tv ────────────────────────────────────────────────────

interface TmdbSearchTvResult {
  id: number;
  name: string;
  original_name: string;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  popularity: number;
  vote_average: number;
  vote_count?: number;
  origin_country: string[];
  original_language: string;
  first_air_date: string | null;
}

interface TmdbSearchTvResponse {
  results: TmdbSearchTvResult[];
}

/** Resposta de GET /tv/{id} — campos que usamos para score e categoria */
interface TmdbTvDetails {
  type?: string | null;
  status?: string | null;
  vote_count?: number;
  number_of_seasons?: number | null;
  networks?: Array<{
    id: number;
    name: string;
    logo_path: string | null;
    origin_country: string;
  }>;
  production_companies?: Array<{
    id: number;
    name: string;
    logo_path: string | null;
    origin_country: string;
  }>;
}

// Mapa de genre_ids → nome (pt-BR aproximado)
const GENRE_NAMES: Record<number, string> = {
  10759: "Ação & Aventura", 16: "Animação", 35: "Comédia", 80: "Crime",
  99: "Documentário", 18: "Drama", 10751: "Família", 10762: "Kids",
  9648: "Mistério", 10763: "Notícias", 10764: "Reality", 10765: "Ficção Científica",
  10766: "Soap", 10767: "Talk", 10768: "Guerra & Política", 37: "Faroeste",
};

async function searchTmdbTv(
  title: string,
  accessToken: string,
  preferAnimation = false,
): Promise<TmdbSearchTvResult | null> {
  const url = new URL("https://api.themoviedb.org/3/search/tv");
  url.searchParams.set("query", title);
  url.searchParams.set("language", "pt-BR");
  url.searchParams.set("page", "1");

  let attempts = 0;
  while (attempts <= MAX_RETRIES) {
    const res = await throttledFetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (res.status === 429 || res.status >= 500) {
      if (attempts >= MAX_RETRIES) return null;
      console.warn(`[ics-enricher] TMDB ${res.status} for "${title}" — retrying in ${RETRY_PAUSE_MS}ms`);
      await sleep(RETRY_PAUSE_MS);
      attempts++;
      continue;
    }

    if (!res.ok) return null;

    const data = (await res.json()) as TmdbSearchTvResponse;
    if (!data.results?.length) return null;

    const cleaned = title.toLowerCase().trim();

    // Se o título foi classificado localmente como ANIMATION (ex: One Piece),
    // preferimos um resultado animado (genre_id=16 ou original_language="ja")
    // antes de cair no exact-match por nome.
    if (preferAnimation) {
      const animExact = data.results.find(
        (r) =>
          (r.name?.toLowerCase() === cleaned || r.original_name?.toLowerCase() === cleaned) &&
          (r.genre_ids?.includes(16) || r.original_language === "ja"),
      );
      if (animExact) return animExact;

      // Sem exact-match animado: tenta qualquer resultado animado com o nome
      const animAny = data.results.find(
        (r) => r.genre_ids?.includes(16) || r.original_language === "ja",
      );
      if (animAny) return animAny;
    }

    // Fallback padrão: exact match por nome, depois primeiro resultado
    const exact = data.results.find(
      (r) =>
        r.name?.toLowerCase() === cleaned ||
        r.original_name?.toLowerCase() === cleaned,
    );
    return exact ?? data.results[0];
  }

  return null;
}

// ── Busca detalhes de /tv/{id} ───────────────────────────────────────────────
// Retorna type, vote_count, number_of_seasons e networks para score de relevância.

async function fetchTvDetails(
  tmdbId: number,
  accessToken: string,
): Promise<TmdbTvDetails | null> {
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}?language=pt-BR`;
  try {
    const res = await throttledFetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as TmdbTvDetails;
  } catch {
    return null;
  }
}

// ── Enriquecer um grupo ───────────────────────────────────────────────────────

async function enrichGroup(
  group: IcsSeriesGroup,
  accessToken: string,
): Promise<TmdbEnrichment | null> {
  const preferAnimation = group.category === "ANIMATION";
  const result = await searchTmdbTv(group.rawTitle, accessToken, preferAnimation);
  if (!result) return null;

  // Busca detalhes completos: type, vote_count, number_of_seasons, networks
  const details = await fetchTvDetails(result.id, accessToken);
  const tmdb_type = details?.type ?? null;

  const refined = refineCategoryFromTmdb(
    group.category,
    result.genre_ids ?? [],
    tmdb_type,
  );

  return {
    tmdb_id:               result.id,
    name:                  result.name,
    original_name:         result.original_name,
    overview:              result.overview,
    poster_path:           result.poster_path,
    backdrop_path:         result.backdrop_path,
    genre_ids:             result.genre_ids ?? [],
    genres:                (result.genre_ids ?? []).map((id) => GENRE_NAMES[id]).filter(Boolean),
    popularity:            result.popularity ?? 0,
    vote_average:          result.vote_average ?? 0,
    vote_count:            details?.vote_count ?? result.vote_count ?? 0,
    number_of_seasons:     details?.number_of_seasons ?? null,
    origin_country:        result.origin_country ?? [],
    original_language:     result.original_language ?? "",
    first_air_date:        result.first_air_date ?? null,
    status:                details?.status ?? null,
    networks:              details?.networks ?? [],
    production_companies:  details?.production_companies ?? [],
    tmdb_type,
    refined_category:      refined,
  };
}

// ── Opções do enricher ────────────────────────────────────────────────────────

export interface EnricherOptions {
  /**
   * Número máximo de enriquecimentos simultâneos (padrão: CONCURRENCY_LIMIT=5).
   * Cada enriquecimento dispara 3 requests TMDB, portanto concurrency=5 →
   * até 15 requests em voo — confortavelmente abaixo do rate-limit da API.
   */
  concurrency?: number;
  /**
   * @deprecated Mantido para retrocompatibilidade; ignorado pelo pipeline principal.
   * Use `concurrency` no lugar.
   */
  batchSize?: number;
  /**
   * @deprecated Mantido para retrocompatibilidade; ignorado pelo pipeline principal.
   */
  batchPauseMs?: number;
  /** Callback chamado após cada grupo ser enriquecido (ordem não garantida) */
  onBatchDone?: (enriched: IcsSeriesGroup[], batchIndex: number, totalBatches: number) => void;
  /** Access token TMDB — se não fornecido, tenta process.env */
  accessToken?: string;
}

// ── Pipeline principal de enriquecimento ──────────────────────────────────────

/**
 * Enriquece um array de IcsSeriesGroup com dados TMDB.
 *
 * Usa concorrência controlada via p-limit (padrão: 5 simultâneas) em vez de
 * batches sequenciais, reduzindo drasticamente o tempo total sem sobrecarregar
 * a API do TMDB. Essencial para evitar timeout em ambiente serverless.
 *
 * Modifica os grupos in-place (preenche group.tmdb).
 * Retorna os grupos enriquecidos (mesma referência, modificada).
 */
export async function enrichSeriesGroups(
  groups: IcsSeriesGroup[],
  options: EnricherOptions = {},
): Promise<IcsSeriesGroup[]> {
  const {
    concurrency  = CONCURRENCY_LIMIT,
    onBatchDone,
    accessToken  = process.env.TMDB_ACCESS_TOKEN?.trim() ?? "",
  } = options;

  if (!accessToken) {
    console.error("[ics-enricher] TMDB_ACCESS_TOKEN não configurado");
    return groups;
  }

  const limit = pLimit(concurrency);
  let done = 0;
  const total = groups.length;

  await Promise.allSettled(
    groups.map((group) =>
      limit(async () => {
        try {
          const enrichment = await enrichGroup(group, accessToken);
          if (enrichment) {
            group.tmdb = enrichment;
            // Refina categoria com dados TMDB
            if (enrichment.refined_category) {
              group.category = enrichment.refined_category;
            }
          }
        } catch (err) {
          console.warn(`[ics-enricher] erro ao enriquecer "${group.rawTitle}":`, err);
        }
        done++;
        // Compatibilidade com onBatchDone: chama a cada grupo concluído
        onBatchDone?.(groups, done - 1, total);
      }),
    ),
  );

  return groups;
}

export async function enrichTopGroups(
  groups: IcsSeriesGroup[],
  topN: number,
  accessToken: string,
): Promise<void> {
  const toEnrich = groups.slice(0, topN);
  let currentBatchSize = DEFAULT_BATCH_SIZE;

  let i = 0;
  while (i < toEnrich.length) {
    const batch = toEnrich.slice(i, i + currentBatchSize);
    let retries = 0;
    let success = false;

    while (!success && retries <= MAX_RETRIES) {
      try {
        await Promise.all(
          batch.map(async (group) => {
            const enrichment = await enrichGroup(group, accessToken);
            if (enrichment) {
              group.tmdb = enrichment;
              if (enrichment.refined_category) {
                group.category = enrichment.refined_category;
              }
            }
          }),
        );
        success = true;
      } catch (err: unknown) {
        const isRateLimit =
          err instanceof Error && err.message.includes("429");
        if (isRateLimit && retries < MAX_RETRIES) {
          console.warn(`[ics-enricher] rate limit batch ${i} — pausa ${RETRY_PAUSE_MS}ms`);
          await sleep(RETRY_PAUSE_MS);
          currentBatchSize = Math.max(1, Math.floor(currentBatchSize / 2));
          retries++;
        } else {
          console.error(`[ics-enricher] batch ${i} falhou:`, err);
          success = true; // Pula este batch
        }
      }
    }

    i += batch.length;
    if (i < toEnrich.length) await sleep(BATCH_PAUSE_MS);
  }
}

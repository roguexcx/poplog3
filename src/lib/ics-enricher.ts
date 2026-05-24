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
// enrichTopGroups removido — pipeline unificado usa enrichSeriesGroups diretamente
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

// ── Detecção de sufixos regionais ────────────────────────────────────────────
// Lista de sufixos de país/região que podem aparecer no rawTitle vindo do
// Banco de Séries (ex: "The Assembly UK", "Big Brother US", "Survivor AU").
// Usado para evitar fallback ambíguo ao TMDB quando o sufixo não existe no
// catálogo TMDB mas o título-base existe.

const REGIONAL_SUFFIXES = new Set([
  "UK", "US", "AU", "NZ", "CA", "BR", "IE", "ZA", "IN", "MX",
  "DE", "FR", "ES", "IT", "NL", "SE", "NO", "DK", "FI", "BE",
  "PT", "PL", "CH", "AT", "CZ", "HU", "RO", "GR", "TR", "IL",
  "JP", "KR", "CN", "TH", "PH", "SG", "HK", "TW",
]);

/**
 * Mapeia sufixo regional (BDS) → código(s) ISO 3166-1 alpha-2 usados em
 * origin_country no TMDB. "UK" no BDS corresponde a "GB" no TMDB.
 * Usado para disambiguar séries homônimas de países diferentes.
 */
const SUFFIX_TO_COUNTRY_CODES: Record<string, string[]> = {
  UK: ["GB"], US: ["US"], AU: ["AU"], NZ: ["NZ"], CA: ["CA"],
  BR: ["BR"], IE: ["IE"], ZA: ["ZA"], IN: ["IN"], MX: ["MX"],
  DE: ["DE"], FR: ["FR"], ES: ["ES"], IT: ["IT"], NL: ["NL"],
  SE: ["SE"], NO: ["NO"], DK: ["DK"], FI: ["FI"], BE: ["BE"],
  PT: ["PT"], PL: ["PL"], CH: ["CH"], AT: ["AT"], CZ: ["CZ"],
  HU: ["HU"], RO: ["RO"], GR: ["GR"], TR: ["TR"], IL: ["IL"],
  JP: ["JP"], KR: ["KR"], CN: ["CN"], TH: ["TH"], PH: ["PH"],
  SG: ["SG"], HK: ["HK"], TW: ["TW"],
};

/**
 * Extrai sufixo regional do título (ex: "The Assembly UK" → { base: "The Assembly", suffix: "UK" }).
 * Retorna null se não houver sufixo reconhecido.
 */
function extractRegionalSuffix(title: string): { base: string; suffix: string } | null {
  const parts = title.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1].toUpperCase();
  if (REGIONAL_SUFFIXES.has(last)) {
    return {
      base: parts.slice(0, -1).join(" "),
      suffix: last,
    };
  }
  return null;
}

async function searchTmdbTvByQuery(
  query: string,
  accessToken: string,
): Promise<TmdbSearchTvResponse | null> {
  const url = new URL("https://api.themoviedb.org/3/search/tv");
  url.searchParams.set("query", query);
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
      console.warn(`[ics-enricher] TMDB ${res.status} for "${query}" — retrying in ${RETRY_PAUSE_MS}ms`);
      await sleep(RETRY_PAUSE_MS);
      attempts++;
      continue;
    }

    if (!res.ok) return null;
    return (await res.json()) as TmdbSearchTvResponse;
  }
  return null;
}

/**
 * Seleciona o melhor resultado TMDB para um título.
 *
 * Ordem de prioridade:
 *  1. Animação exata (quando preferAnimation=true)
 *  2. Nome exato + origin_country corresponde ao sufixo regional (ex: UK → GB)
 *  3. Nome exato sem restrição de país
 *  4. Qualquer resultado com origin_country correspondente (para variantes regionais)
 *  5. null — sem match confiável
 *
 * Quando `regionalSuffix` é fornecido, evitamos devolver o primeiro resultado
 * arbitrário: preferimos um resultado cujo origin_country bate com o sufixo.
 * Isso distingue "The Assembly UK" (GB, tmdb 290057) de "The Assembly" (US/CA).
 */
function pickBestResult(
  results: TmdbSearchTvResult[],
  cleaned: string,
  preferAnimation: boolean,
  regionalSuffix?: string | null,
): TmdbSearchTvResult | null {
  if (!results.length) return null;

  const countryCodes = regionalSuffix ? (SUFFIX_TO_COUNTRY_CODES[regionalSuffix] ?? []) : [];

  function matchesCountry(r: TmdbSearchTvResult): boolean {
    if (!countryCodes.length) return false;
    return (r.origin_country ?? []).some((c) => countryCodes.includes(c));
  }

  if (preferAnimation) {
    const animExact = results.find(
      (r) =>
        (r.name?.toLowerCase() === cleaned || r.original_name?.toLowerCase() === cleaned) &&
        (r.genre_ids?.includes(16) || r.original_language === "ja"),
    );
    if (animExact) return animExact;
    const animAny = results.find(
      (r) => r.genre_ids?.includes(16) || r.original_language === "ja",
    );
    if (animAny) return animAny;
  }

  // Exact name match + country match (melhor caso para variantes regionais)
  if (countryCodes.length) {
    const exactCountry = results.find(
      (r) =>
        (r.name?.toLowerCase() === cleaned || r.original_name?.toLowerCase() === cleaned) &&
        matchesCountry(r),
    );
    if (exactCountry) return exactCountry;
  }

  // Exact name match (sem restrição de país)
  // Preferimos resultados recentes (últimos 20 anos) sobre séries antigas homônimas.
  // Ex: "Raw" busca → encontra "Raw" de 1993 (WWE) antes de um show atual com mesmo nome.
  const RECENT_CUTOFF_YEAR = new Date().getFullYear() - 20;

  function isRecentEnough(r: TmdbSearchTvResult): boolean {
    if (!r.first_air_date) return true; // sem data → não penalizar
    const year = parseInt(r.first_air_date.slice(0, 4), 10);
    return isNaN(year) || year >= RECENT_CUTOFF_YEAR;
  }

  const exactMatches = results.filter(
    (r) =>
      r.name?.toLowerCase() === cleaned ||
      r.original_name?.toLowerCase() === cleaned,
  );

  if (exactMatches.length) {
    // Prefere exact match recente; se nenhum for recente, pega o primeiro exact match
    const recentExact = exactMatches.find(isRecentEnough);
    return recentExact ?? exactMatches[0];
  }

  // Apenas country match (sem exact name) — útil quando o título TMDB tem variação ortográfica
  if (countryCodes.length) {
    const countryOnly = results.find(matchesCountry);
    if (countryOnly) return countryOnly;
  }

  // Sem match confiável
  return null;
}

interface TmdbSearchResult {
  result: TmdbSearchTvResult;
  /** Sufixo regional detectado no rawTitle (ex: "UK"). Null se não houver. */
  variantSuffix: string | null;
  /** True quando o match foi obtido apenas removendo o sufixo regional do título */
  matchedWithoutSuffix: boolean;
}

async function searchTmdbTv(
  title: string,
  accessToken: string,
  preferAnimation = false,
): Promise<TmdbSearchResult | null> {
  const cleaned = title.toLowerCase().trim();
  const regional = extractRegionalSuffix(title);

  // 1ª tentativa: busca com o título completo (incluindo sufixo, se houver)
  const fullData = await searchTmdbTvByQuery(title, accessToken);
  if (fullData?.results?.length) {
    // Passa o sufixo regional para que pickBestResult prefira o país certo
    // (ex: "The Assembly UK" → prefere result com origin_country GB)
    const exact = pickBestResult(fullData.results, cleaned, preferAnimation, regional?.suffix);
    if (exact) {
      return { result: exact, variantSuffix: regional?.suffix ?? null, matchedWithoutSuffix: false };
    }
  }

  // 2ª tentativa (só quando há sufixo regional): buscar pelo título-base sem o sufixo.
  // Nesse caso, marcamos como variante regional — o match é provavelmente do show-mãe,
  // não de uma versão regional específica.
  if (regional) {
    const baseData = await searchTmdbTvByQuery(regional.base, accessToken);
    if (baseData?.results?.length) {
      const baseCleaned = regional.base.toLowerCase().trim();
      // Passa o sufixo regional: mesmo buscando pelo título-base, queremos
      // o resultado cujo origin_country bate com o sufixo (ex: base="The Assembly"
      // com suffix="UK" → prefere o resultado com origin_country GB, tmdb 290057).
      const exact = pickBestResult(baseData.results, baseCleaned, preferAnimation, regional.suffix);
      // Sem fallback para results[0] quando há sufixo regional e sem match de país:
      // é melhor não enriquecer do que associar ao show errado.
      const picked = exact;
      if (picked) {
        console.log(
          `[ics-enricher] variant-match: "${title}" → base="${regional.base}" suffix="${regional.suffix}"` +
          ` tmdb_id=${picked.id} tmdb_name="${picked.name}" country=${(picked.origin_country ?? []).join(",")}`,
        );
        return { result: picked, variantSuffix: regional.suffix, matchedWithoutSuffix: true };
      }
      // Sem match de país encontrado: loga e deixa cair para o fallback geral
      console.log(
        `[ics-enricher] variant-no-country-match: "${title}" suffix="${regional.suffix}"` +
        ` — ${baseData.results.length} results, nenhum com country match`,
      );
    }
  }

  // Último recurso: primeiro resultado da busca com título completo (comportamento anterior)
  if (fullData?.results?.[0]) {
    console.log(
      `[ics-enricher] fallback-first-result: "${title}" → tmdb_id=${fullData.results[0].id}` +
      ` tmdb_name="${fullData.results[0].name}"`,
    );
    return { result: fullData.results[0], variantSuffix: regional?.suffix ?? null, matchedWithoutSuffix: false };
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
  const searchResult = await searchTmdbTv(group.rawTitle, accessToken, preferAnimation);
  if (!searchResult) return null;

  const { result, variantSuffix, matchedWithoutSuffix } = searchResult;

  // Marcar variantCountry no grupo quando o match foi obtido removendo sufixo regional.
  // Isso preserva a informação para deduplicação segura no pipeline e para a UI.
  if (matchedWithoutSuffix && variantSuffix) {
    group.variantCountry = variantSuffix;
  }

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

// enrichTopGroups removido — use enrichSeriesGroups diretamente

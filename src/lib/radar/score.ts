// ── src/lib/radar/score.ts ────────────────────────────────────────────────────
// Sistema de score unificado para o Radar.
// Usado por todas as fontes de dados: ICS (BancoSeries) e TMDB direto.
//
// FILOSOFIA:
//   Score serve para ORDENACAO e DISTRIBUICAO, nao para bloqueio.
//   Itens com score alto sobem naturalmente; itens com score baixo
//   ficam em secoes secundarias ou ocultos -- nunca bloqueados por categoria.
//   Apenas DAILY_SOAP e categorias estruturais (SPORTS, NEWS etc.) sao
//   bloqueados rigidamente, independente de score.
//
// COMPONENTES (total ~100 pts base, pode exceder com bonus contextuais):
//   1. Popularidade TMDB          (0-35 pts)  -- curva log2
//   2. Engajamento/qualidade       (0-25 pts)  -- vote_average + vote_count
//   3. Tier editorial de rede/     (0-30 pts)  -- hierarquia Tier 1/2/3
//      produtora/plataforma
//   4. Trending boost              (0-20 pts)  -- trending day/week TMDB
//   5. Disponibilidade BR          (0-15 pts)  -- provider BR confirmado
//   6. Contexto temporal           (0-20 pts)  -- estreia, retorno, finale
//   7. Origem/idioma               (-5 a +15)  -- pt/BR +15, en +10, es +5
//
// HIERARQUIA EDITORIAL DE TIERS:
//   Tier 1 -- Peso maximo (+30):
//     HBO/Max, Apple TV+, Netflix, Disney+, FX, Warner Bros., Sony Pictures,
//     Universal, A24, Searchlight, Neon, New Line Cinema
//   Tier 2 -- Peso alto (+20):
//     Prime Video, Paramount+, Hulu, AMC, Showtime, Starz, Peacock, Canal+,
//     Globoplay, Telecine, BBC, Lionsgate, Legendary, Focus Features,
//     National Geographic, Studio Dragon, CJ ENM
//     (BBC e Tier 2 -- nao Tier 1 -- para que producoes locais britanicas
//     de nicho nao dominem os destaques sem outros sinais de relevancia)
//   Tier 3 -- Peso medio (+12):
//     Discovery, TLC, HGTV, Food Network, History, PBS, ITV, Channel 4,
//     Sky, Fuji TV, Tokyo MX e outras redes com menor forca editorial
// ─────────────────────────────────────────────────────────────────────────────

import { isAnime } from "./categories";

// ── Tiers de redes/emissoras ──────────────────────────────────────────────────

const NETWORK_TIER_1: Record<number, number> = {
  49:   30, // HBO
  2552: 30, // Apple TV+
  213:  30, // Netflix
  1024: 30, // Amazon Prime Video
  453:  30, // Hulu
  2739: 30, // Disney+
  3353: 30, // Max (HBO Max)
  6:    28, // FX
};

const NETWORK_TIER_2: Record<number, number> = {
  67:   20, // Showtime
  174:  20, // AMC
  4:    20, // BBC One
  393:  20, // BBC Two
  9:    20, // BBC Three
  2:    20, // BBC Two (alt)
  3327: 20, // BBC Studios
  57:   20, // Peacock
  318:  20, // Starz
  4330: 20, // Paramount+
  64:   18, // Sky One
  1709: 18, // Canal+
  2336: 20, // Globoplay
  3527: 18, // Telecine Play
  66:   18, // National Geographic
  4353: 18, // tvN (Studio Dragon / CJ ENM)
  3290: 18, // Studio Dragon
};

const NETWORK_TIER_3: Record<number, number> = {
  5:    12, // NBC
  19:   12, // FOX
  16:   12, // CBS
  11:   12, // Adult Swim
  65:   10, // History
  29:   10, // PBS
  56:   10, // Bravo
  281:  10, // ITV
  332:  8,  // Channel 5 (UK)
  1267: 8,  // HGTV
  182:  8,  // TLC
  // Anime JP
  1:    18, // Fuji TV
  3:    16, // Tokyo MX
  6267: 16, // TV Tokyo
};

// Mapa consolidado: Tier 1 sobrescreve Tier 2 e 3
const NETWORK_TIER: Record<number, number> = {
  ...NETWORK_TIER_3,
  ...NETWORK_TIER_2,
  ...NETWORK_TIER_1,
};

// ── Tiers de produtoras/estudios ──────────────────────────────────────────────

const STUDIO_TIER_1: Record<number, number> = {
  41077:  28, // A24
  12:     26, // New Line Cinema / Warner Bros
  3268:   26, // HBO Entertainment
  7505:   24, // Sony Pictures Television
  11073:  22, // Sony Pictures TV (alt)
  9993:   22, // DC Studios
  2:      22, // Walt Disney Pictures
  420:    22, // Marvel Studios
  1:      20, // Lucasfilm
  3287:   22, // Bad Robot
  127928: 24, // Searchlight Pictures
};

const STUDIO_TIER_2: Record<number, number> = {
  33:    18, // Universal Television
  21:    18, // Metro-Goldwyn-Mayer (MGM)
  1632:  18, // Lionsgate Television
  523:   16, // Legendary Entertainment
  7:     16, // DreamWorks
  306:   14, // Blumhouse Productions
  2527:  14, // Anonymous Content
  10146: 18, // Focus Features
};

const STUDIO_TIER_3: Record<number, number> = {
  11:   12, // Paramount Pictures TV
  4:    12, // Regency Enterprises
  17:   12, // John Wells Productions
  73:   10, // Village Roadshow
  1885: 10, // Temple Hill Entertainment
};

const STUDIO_TIER: Record<number, number> = {
  ...STUDIO_TIER_3,
  ...STUDIO_TIER_2,
  ...STUDIO_TIER_1,
};

// ── Idiomas com trending boost reduzido ───────────────────────────────────────

const REDUCED_TRENDING_LANGS = new Set(["ko", "zh", "th", "hi", "tl"]);

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface ScoreInputTmdb {
  tmdb_id: number;
  popularity?: number | null;
  vote_average?: number | null;
  vote_count?: number | null;
  original_language?: string | null;
  origin_country?: string[] | null;
  networks?: Array<{ id: number }> | null;
  production_companies?: Array<{ id: number }> | null;
  genre_ids?: number[] | null;
  genres?: Array<{ id: number }> | string[] | null;
  name?: string | null;
  original_name?: string | null;
  /** Providers disponiveis no Brasil (nomes, ex: ["Netflix", "Globoplay"]) */
  brazil_providers?: string[] | null;
  /** true se este item tem estreia de episodio hoje ou nos proximos 3 dias */
  is_episode_premiere?: boolean | null;
  /** true se esta temporada esta retornando apos hiato (season return) */
  is_season_return?: boolean | null;
  /** true se e estreia de nova temporada */
  is_season_premiere?: boolean | null;
  /** true se e finale de temporada ou serie */
  is_finale?: boolean | null;
  /** true se faz parte de franquia conhecida (colecao TMDB, Marvel, Star Wars etc.) */
  is_known_franchise?: boolean | null;
  /** true se a data foi confirmada/ajustada manualmente por admin */
  has_admin_confirmed_date?: boolean | null;
}

export interface ScoreBreakdownUnified {
  popularity: number;
  quality: number;
  networkTier: number;
  trendingBoost: number;
  brazilBoost: number;
  temporalBoost: number;
  originBoost: number;
  total: number;
}

export interface ScorePenalty {
  reason: string;
  /** Valor negativo, ex: -15 */
  value: number;
}

// ── Funcao principal de score ─────────────────────────────────────────────────

/**
 * Calcula o score de relevancia unificado (0-140) para qualquer item do pipeline.
 */
export function computeUnifiedScore(
  tmdb: ScoreInputTmdb,
  trendingDay: Set<number> = new Set(),
  trendingWeek: Set<number> = new Set(),
): number {
  return computeScoreBreakdown(tmdb, trendingDay, trendingWeek).total;
}

/**
 * Calcula e retorna o breakdown completo do score para diagnostico/logs.
 */
export function computeScoreBreakdown(
  tmdb: ScoreInputTmdb,
  trendingDay: Set<number> = new Set(),
  trendingWeek: Set<number> = new Set(),
): ScoreBreakdownUnified {
  // 1. Popularidade (0-35 pts)
  const pop = tmdb.popularity ?? 0;
  const popularity = Math.min(35, Math.round(Math.log2(Math.max(1, pop)) * 4.5));

  // 2. Qualidade/Engajamento (0-25 pts)
  const avg = tmdb.vote_average ?? 0;
  const cnt = tmdb.vote_count ?? 0;
  let quality: number;
  if (cnt >= 500)      quality = Math.round((avg / 10) * 25);
  else if (cnt >= 100) quality = Math.round((avg / 10) * 18);
  else if (cnt >= 20)  quality = Math.round((avg / 10) * 10);
  else if (cnt >= 5)   quality = Math.round((avg / 10) * 5);
  else                 quality = -10; // penalidade leve por falta de dados

  // 3. Tier de rede OU produtora (0-30 pts, pega o maior)
  let networkBoost = 0;
  for (const net of tmdb.networks ?? []) {
    const tier = NETWORK_TIER[net.id] ?? 0;
    if (tier > networkBoost) networkBoost = tier;
  }
  let studioBoost = 0;
  for (const co of tmdb.production_companies ?? []) {
    const tier = STUDIO_TIER[co.id] ?? 0;
    if (tier > studioBoost) studioBoost = tier;
  }
  const networkTier = Math.min(30, Math.max(networkBoost, studioBoost));

  // 4. Trending boost (0-20 pts)
  const lang = tmdb.original_language ?? "";
  const title = tmdb.name ?? tmdb.original_name ?? "";
  const genreIds = tmdb.genre_ids
    ?? (tmdb.genres?.flatMap((g) => typeof g === "string" ? [] : [g.id]) ?? []);
  const isAnimeSeries = lang === "ja" && isAnime(title, genreIds);

  let trendingBoost: number;
  if (REDUCED_TRENDING_LANGS.has(lang)) {
    if (trendingDay.has(tmdb.tmdb_id))       trendingBoost = 10;
    else if (trendingWeek.has(tmdb.tmdb_id)) trendingBoost = 5;
    else                                      trendingBoost = 0;
  } else if (lang === "ja" && !isAnimeSeries) {
    trendingBoost = (trendingDay.has(tmdb.tmdb_id) || trendingWeek.has(tmdb.tmdb_id)) ? 5 : 0;
  } else {
    if (trendingDay.has(tmdb.tmdb_id))       trendingBoost = 20;
    else if (trendingWeek.has(tmdb.tmdb_id)) trendingBoost = 10;
    else                                      trendingBoost = 0;
  }

  // 5. Disponibilidade Brasil (0-15 pts)
  let brazilBoost = 0;
  if ((tmdb.brazil_providers ?? []).length > 0) brazilBoost += 15;
  if (tmdb.has_admin_confirmed_date)             brazilBoost += 5;
  brazilBoost = Math.min(15, brazilBoost);

  // 6. Contexto temporal (0-20 pts) -- pega o maior bonus disponivel
  let temporalBoost = 0;
  if (tmdb.is_season_return)    temporalBoost = Math.max(temporalBoost, 20);
  if (tmdb.is_season_premiere)  temporalBoost = Math.max(temporalBoost, 18);
  if (tmdb.is_episode_premiere) temporalBoost = Math.max(temporalBoost, 15);
  if (tmdb.is_finale)           temporalBoost = Math.max(temporalBoost, 12);
  if (tmdb.is_known_franchise)  temporalBoost = Math.max(temporalBoost, 8);
  temporalBoost = Math.min(20, temporalBoost);

  // 7. Origem/idioma (-5 a +15)
  const originCountries = tmdb.origin_country ?? [];
  const isBrazilian = originCountries.includes("BR") || lang === "pt";
  let originBoost: number;
  if (isBrazilian)       originBoost = 15;
  else if (lang === "en") originBoost = 10;
  else if (lang === "es") originBoost = 5;
  else if (isAnimeSeries) originBoost = 5;
  else                    originBoost = 0;

  const total = Math.max(0, Math.min(140,
    popularity + quality + networkTier + trendingBoost + brazilBoost + temporalBoost + originBoost,
  ));

  return { popularity, quality, networkTier, trendingBoost, brazilBoost, temporalBoost, originBoost, total };
}

/**
 * Aplica penalidades de score baseadas em sinais editoriais negativos.
 * Retorna o score ajustado (nunca negativo).
 * Penalidades nao bloqueiam -- apenas rebaixam progressivamente.
 */
export function applyScorePenalties(
  baseScore: number,
  penalties: ScorePenalty[],
): number {
  const total = penalties.reduce((sum, p) => sum + p.value, 0);
  return Math.max(0, baseScore + total);
}

/**
 * Threshold de referencia -- NAO usado para filtrar, apenas para logs e debug.
 */
export const SCORE_REFERENCE_THRESHOLD = 30;

/**
 * Helper de diagnostico: retorna o tier de uma rede por ID.
 */
export function getNetworkTierLabel(networkId: number): "tier1" | "tier2" | "tier3" | "unknown" {
  if (NETWORK_TIER_1[networkId] !== undefined) return "tier1";
  if (NETWORK_TIER_2[networkId] !== undefined) return "tier2";
  if (NETWORK_TIER_3[networkId] !== undefined) return "tier3";
  return "unknown";
}

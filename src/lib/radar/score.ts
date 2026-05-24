// ── src/lib/radar/score.ts ────────────────────────────────────────────────────
// Sistema de score unificado para o Radar/Agenda.
// Usado por todas as fontes de dados: ICS (BancoSéries) e TMDB direto.
//
// FILOSOFIA DE SCORE:
//   Score serve para ORDENAÇÃO, não para corte.
//   Nenhum item é descartado automaticamente por ter score baixo.
//   Filtros de exibição são apenas categorias estruturais (HIDDEN/DISCARD).
//
// COMPONENTES (total ~100 pts):
//   1. Popularidade TMDB     (0-35 pts)  — curva log2
//   2. Qualidade de votos    (0-25 pts)  — vote_average com peso mínimo de votos
//   3. Tier de rede/produtora (0-30 pts) — emissora ou produtora de prestígio
//   4. Trending boost        (0-20 pts)  — está no trending day/week do TMDB?
//   5. Origem/idioma         (-5 a +15)  — pt/BR +15, en +10, es +5, anime +5
//
// IDIOMA:
//   - pt / BR origin: +15 (prioridade máxima para conteúdo brasileiro)
//   - en:             +10
//   - es:             +5
//   - ja + anime:     +5 (anime japonês tratado separadamente)
//   - ko/zh/th/hi/tl: 0  (sem boost, sem penalidade — reduz saturação de K-drama)
//   - outros:         0
//   O trending boost para idiomas ko/zh/th/hi/tl é reduzido para metade,
//   pois o trending TMDB global é frequentemente dominado por K-dramas.
//
// ANIME:
//   Anime (ja + genre Animation) é separado de "conteúdo asiático genérico":
//   - Recebe boost de origin (+5, igual a "es")
//   - Recebe trending boost completo (não reduzido)
//   - NOT agrupado com ko/zh no bloco "Ásia" do editorial balance
// ──────────────────────────────────────────────────────────────────────────────

import { isAnime } from "./categories";

// ── Tiers de redes e produtoras ───────────────────────────────────────────────

/**
 * Tier de REDES/EMISSORAS (campo `networks` do TMDB).
 * Proxy de qualidade de produção + audiência garantida.
 */
const NETWORK_TIER: Record<number, number> = {
  // Tier Premium (+30) — streaming global ou canal prestige
  49:   30, // HBO
  2552: 30, // Apple TV+
  213:  30, // Netflix
  1024: 30, // Amazon Prime Video
  453:  30, // Hulu
  2739: 30, // Disney+
  3353: 30, // Max (HBO Max)
  6:    28, // FX
  67:   25, // Showtime
  174:  25, // AMC
  // Tier Qualidade (+20)
  4:    20, // BBC One
  393:  20, // BBC Two
  57:   20, // Peacock
  318:  20, // Starz
  4330: 20, // Paramount+
  64:   18, // Sky One
  1709: 18, // Canal+
  // Tier Mainstream (+10)
  2:    10, // ABC
  5:    10, // NBC
  19:   10, // FOX
  16:   10, // CBS
  11:   10, // Adult Swim
  56:   10, // Bravo
  65:   8,  // History
  66:   8,  // National Geographic
  29:   8,  // PBS
  // Anime premium JP (+20)
  1:    20, // Fuji TV
  3:    18, // Tokyo MX
  6267: 18, // TV Tokyo
};

/**
 * Tier de PRODUTORAS (campo `production_companies` do TMDB).
 * Usamos o MAIOR boost entre network e studio (não somamos).
 */
const STUDIO_TIER: Record<number, number> = {
  41077: 28, // A24
  12:    22, // New Line Cinema / Warner Bros Television
  3268:  22, // HBO Entertainment
  7505:  22, // Sony Pictures Television
  11073: 20, // Sony Pictures Television (alt)
  9993:  20, // DC Studios
  2:     18, // Walt Disney Pictures
  21:    18, // Metro-Goldwyn-Mayer (MGM)
  33:    18, // Universal Television
  1632:  18, // Lionsgate Television
  420:   18, // Marvel Studios
  3287:  18, // Bad Robot
  1:     18, // Lucasfilm
  306:   16, // Blumhouse Productions
  7:     16, // DreamWorks
  523:   16, // Legendary Entertainment
  2527:  16, // Anonymous Content
  11:    14, // Paramount Pictures Television
  4:     14, // Regency Enterprises
  17:    14, // John Wells Productions
  1885:  14, // Temple Hill Entertainment
  73:    12, // Village Roadshow
};

// ── Idiomas sem boost de trending ─────────────────────────────────────────────

/**
 * Idiomas que recebem trending boost reduzido (50%).
 * TMDB trending global é frequentemente dominado por K-dramas e conteúdo asiático.
 * Reduzimos o boost para evitar saturação, mas não bloqueamos completamente.
 * Nota: "ja" (japonês) é tratado separadamente — anime recebe boost completo.
 */
const REDUCED_TRENDING_LANGS = new Set(["ko", "zh", "th", "hi", "tl"]);

// ── Tipos de entrada ──────────────────────────────────────────────────────────

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
}

export interface ScoreBreakdownUnified {
  popularity: number;
  quality: number;
  networkTier: number;
  trendingBoost: number;
  originBoost: number;
  total: number;
}

// ── Função principal de score ─────────────────────────────────────────────────

/**
 * Calcula o score de relevância unificado (0-100+) para qualquer item do pipeline.
 * Funciona para ICS (BancoSéries) e TMDB direto.
 *
 * @param tmdb       Dados TMDB do item
 * @param trendingDay  Set de IDs no trending do dia
 * @param trendingWeek Set de IDs no trending da semana
 * @returns Score numérico (0-100, pode exceder em casos excepcionais)
 */
export function computeUnifiedScore(
  tmdb: ScoreInputTmdb,
  trendingDay: Set<number> = new Set(),
  trendingWeek: Set<number> = new Set(),
): number {
  const breakdown = computeScoreBreakdown(tmdb, trendingDay, trendingWeek);
  return breakdown.total;
}

/**
 * Calcula e retorna o breakdown completo do score para diagnóstico/logs.
 */
export function computeScoreBreakdown(
  tmdb: ScoreInputTmdb,
  trendingDay: Set<number> = new Set(),
  trendingWeek: Set<number> = new Set(),
): ScoreBreakdownUnified {
  // ── 1. Popularidade (0-35 pts) ──────────────────────────────────────────────
  const pop = tmdb.popularity ?? 0;
  const popularity = Math.min(35, Math.round(Math.log2(Math.max(1, pop)) * 4.5));

  // ── 2. Qualidade (0-25 pts) ─────────────────────────────────────────────────
  const avg = tmdb.vote_average ?? 0;
  const cnt = tmdb.vote_count ?? 0;
  let quality: number;
  if (cnt >= 50) {
    quality = Math.round((avg / 10) * 25);
  } else if (cnt >= 10) {
    quality = Math.round((avg / 10) * 12);
  } else {
    quality = -15; // penalidade: dados insuficientes
  }

  // ── 3. Tier de rede OU produtora (0-30 pts, pega o maior) ──────────────────
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

  const networkTier = Math.max(networkBoost, studioBoost);

  // ── 4. Trending boost (0-20 pts) ────────────────────────────────────────────
  const lang = tmdb.original_language ?? "";
  const title = tmdb.name ?? tmdb.original_name ?? "";
  const genreIds = tmdb.genre_ids
    ?? (tmdb.genres?.flatMap((g) => typeof g === "string" ? [] : [g.id]) ?? []);

  const isAnimeSeries = lang === "ja" && isAnime(title, genreIds);

  let trendingBoost: number;
  if (REDUCED_TRENDING_LANGS.has(lang)) {
    // K-drama, C-drama etc.: boost reduzido (50%)
    if (trendingDay.has(tmdb.tmdb_id))        trendingBoost = 10;
    else if (trendingWeek.has(tmdb.tmdb_id))  trendingBoost = 5;
    else                                       trendingBoost = 0;
  } else if (lang === "ja" && !isAnimeSeries) {
    // Japonês não-anime: boost reduzido (25%)
    if (trendingDay.has(tmdb.tmdb_id) || trendingWeek.has(tmdb.tmdb_id)) trendingBoost = 5;
    else trendingBoost = 0;
  } else {
    // Todos os outros (en, pt, es, anime ja): boost completo
    if (trendingDay.has(tmdb.tmdb_id))        trendingBoost = 20;
    else if (trendingWeek.has(tmdb.tmdb_id))  trendingBoost = 10;
    else                                       trendingBoost = 0;
  }

  // ── 5. Origem/idioma (-5 a +15) ─────────────────────────────────────────────
  const originCountries = tmdb.origin_country ?? [];
  const isBrazilian = originCountries.includes("BR") || lang === "pt";

  let originBoost: number;
  if (isBrazilian) {
    originBoost = 15; // Conteúdo BR: máxima prioridade
  } else if (lang === "en") {
    originBoost = 10;
  } else if (lang === "es") {
    originBoost = 5;
  } else if (isAnimeSeries) {
    originBoost = 5; // Anime JP: mesmo boost que espanhol
  } else {
    originBoost = 0;
  }

  const total = Math.max(0, Math.min(120, popularity + quality + networkTier + trendingBoost + originBoost));

  return { popularity, quality, networkTier, trendingBoost, originBoost, total };
}

/**
 * Threshold de referência — NÃO usado para filtrar, apenas para logs e debug.
 * Score abaixo deste valor é registrado mas o item ainda aparece no Radar.
 */
export const SCORE_REFERENCE_THRESHOLD = 38;

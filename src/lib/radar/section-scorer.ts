// ── src/lib/radar/section-scorer.ts ─────────────────────────────────────────
// Score de SEÇÃO para o Radar Geral.
//
// Propósito distinto de computeUnifiedScore (src/lib/radar/score.ts):
//   computeUnifiedScore  → score de qualidade intrínseca do título.
//   computeSectionScore  → score de relevância TEMPORAL + editorial para
//     decidir em qual seção o item aparece e com que prioridade.
//
// NOVA ARQUITETURA — DISTRIBUIÇÃO POR FAIXAS DE SCORE:
//   Em vez da lógica binária "bloqueado / aprovado", o sistema distribui
//   itens em quatro faixas visuais com base no score final:
//
//   Destaques (scoreTier: "spotlight")  → score ≥ 85
//     Aparece no topo do Radar, com destaque visual máximo.
//     Poucos itens por vez — só os mais relevantes do momento.
//
//   Novidades / Vem Aí (scoreTier: "main")  → score ≥ 55
//     Seções principais do Radar: estreias recentes, próximos episódios,
//     lançamentos em breve. Maioria dos itens relevantes cai aqui.
//
//   Também Relevantes (scoreTier: "secondary")  → score ≥ 30
//     Seção complementar para itens com menos sinais positivos, conteúdos
//     de nicho com algum interesse, ou itens temporalmente distantes.
//
//   Ocultos (scoreTier: "hidden")  → score < 30
//     Item existe no pipeline mas não é exibido. Pode aparecer com
//     pesquisa direta ou em contextos personalizados.
//
// CAPS POR TIPO:
//   Mantidos para evitar saturação de formatos específicos em cada seção.
//   Caps são mais permissivos que antes — o objetivo é diversidade, não bloqueio.
//
// FLUXO:
//   computeUnifiedScore (qualidade intrínseca)
//   → classifyRadarEligibility (hard blocks + penalidades)
//   → applyScorePenalties (score ajustado)
//   → computeSectionScore (temporalidade + qualidade)
//   → getScoreTier (faixa visual)
//   → distribuição final nas seções
// ────────────────────────────────────────────────────────────────────────────

import { getScoreTier, type ScoreTier, SCORE_THRESHOLDS } from "./categories";

export type SectionBucket =
  | "todayStrict"      // data == hoje
  | "yesterdayStrong"  // data == ontem, score bom
  | "recentStrong"     // últimos 7d, score bom
  | "nearFuture"       // amanhã até +3d
  | "midFuture"        // +4d até +7d
  | "farFuture"        // +8d até +30d
  | "undated"          // sem data (trending/on_the_air)
  | "overflow";        // fora da janela de 30 dias

export interface SectionScoreResult {
  bucket: SectionBucket;
  sectionScore: number;
  temporalBonus: number;
  qualityScore: number;
  scoreTier: ScoreTier;
  isAnime: boolean;
  isRealityOrNonfiction: boolean;
  isGenericGameShow: boolean;
  hasValidTmdb: boolean;
}

// IDs de redes premium — usados para detectar game show genérico
const PREMIUM_NETWORK_IDS = new Set([
  49, 2552, 213, 1024, 453, 2739, 3353, 6, 4330, 67, 174, 4, 393, 1709,
  57, 64, 318, 2336, 3527,
]);

// Bônus por temporalidade (dias relativos ao dia atual)
function temporalBonus(daysFromToday: number | null): number {
  if (daysFromToday === null) return 5;  // undated: on_the_air
  if (daysFromToday === 0)   return 30;  // hoje: urgência máxima
  if (daysFromToday === -1)  return 25;  // ontem: ainda quente
  if (daysFromToday >= -7 && daysFromToday <= -2) return 15;  // recente
  if (daysFromToday >= 1  && daysFromToday <= 3)  return 12;  // futuro próximo
  if (daysFromToday >= 4  && daysFromToday <= 7)  return 8;   // futuro médio
  if (daysFromToday >= 8  && daysFromToday <= 30) return 4;   // futuro distante
  return 0;
}

function daysFromTodayFn(dateStr: string | null | undefined, todayStr: string): number | null {
  if (!dateStr) return null;
  const d = dateStr.slice(0, 10);
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const [ey, em, ed] = d.split("-").map(Number);
  const todayMs = Date.UTC(ty, tm - 1, td);
  const eventMs = Date.UTC(ey, em - 1, ed);
  return Math.round((eventMs - todayMs) / 86_400_000);
}

interface ScorerInput {
  category: string;
  /** Score de qualidade já calculado (computeUnifiedScore + penalidades aplicadas) */
  relevanceScore: number;
  nextAirDate?: string | null;
  tmdb?: {
    genre_ids?: number[] | null;
    original_language?: string | null;
    networks?: Array<{ id: number; name?: string | null }> | null;
    popularity?: number | null;
    vote_count?: number | null;
    tmdb_type?: string | null;
  } | null;
}

const ANIME_GENRE_ID = 16;

export function computeSectionScore(
  item: ScorerInput,
  todayStr: string,
): SectionScoreResult {
  const hasValidTmdb = item.tmdb != null;
  const days = daysFromTodayFn(item.nextAirDate, todayStr);
  const tBonus = temporalBonus(days);
  const qualityScore = item.relevanceScore ?? 0;
  const sectionScore = qualityScore + tBonus;

  // Faixa de score — determina a seção visual onde o item aparece
  const scoreTier = getScoreTier(sectionScore);

  // ── Classificadores internos ─────────────────────────────────────────────

  const lang = item.tmdb?.original_language ?? "";
  const genreIds = item.tmdb?.genre_ids ?? [];
  const isAnime = lang === "ja" && genreIds.includes(ANIME_GENRE_ID);

  const isRealityOrNonfiction =
    item.category === "REALITY_PREMIUM" ||
    item.category === "REALITY" ||
    item.category === "DOCUMENTARY";

  // Game show genérico: reality/nonfiction sem rede premium forte + baixo engajamento
  // Indica formato de quiz/variety fraco que não deve dominar seções principais
  const networks = item.tmdb?.networks ?? [];
  const hasPremiumNet = networks.some((n) => PREMIUM_NETWORK_IDS.has(n.id));
  const pop = item.tmdb?.popularity ?? 0;
  const votes = item.tmdb?.vote_count ?? 0;
  const tmdbType = item.tmdb?.tmdb_type ?? "";
  const isGenericGameShow =
    isRealityOrNonfiction &&
    !hasPremiumNet &&
    pop < 40 &&
    votes < 300 &&
    tmdbType !== "Scripted";

  // ── Bucket temporal ───────────────────────────────────────────────────────
  let bucket: SectionBucket;
  if (days === null) {
    bucket = "undated";
  } else if (days === 0) {
    bucket = "todayStrict";
  } else if (days === -1) {
    bucket = "yesterdayStrong";
  } else if (days >= -7 && days <= -2) {
    bucket = "recentStrong";
  } else if (days >= 1 && days <= 3) {
    bucket = "nearFuture";
  } else if (days >= 4 && days <= 7) {
    bucket = "midFuture";
  } else if (days >= 8 && days <= 30) {
    bucket = "farFuture";
  } else {
    bucket = "overflow";
  }

  return {
    bucket,
    sectionScore,
    temporalBonus: tBonus,
    qualityScore,
    scoreTier,
    isAnime,
    isRealityOrNonfiction,
    isGenericGameShow,
    hasValidTmdb,
  };
}

// ── Caps por seção ────────────────────────────────────────────────────────────
// Caps mais permissivos — objetivo é diversidade, não bloqueio.
// O rebaixamento por score já filtra naturalmente; os caps evitam saturação.

export interface SectionCaps {
  anime:           number;
  realityNonfiction: number;
  gameShow:        number;
  noTmdb:          number;
  /** Máximo de itens na faixa "secondary" (Também Relevantes) */
  secondaryTier:   number;
}

export const CAPS_TODAY: SectionCaps    = { anime: 3, realityNonfiction: 4, gameShow: 1, noTmdb: 2, secondaryTier: 5 };
export const CAPS_WEEK: SectionCaps     = { anime: 5, realityNonfiction: 6, gameShow: 2, noTmdb: 4, secondaryTier: 10 };
export const CAPS_MONTH: SectionCaps    = { anime: 5, realityNonfiction: 5, gameShow: 2, noTmdb: 3, secondaryTier: 8 };

export interface CapState {
  anime:             number;
  realityNonfiction: number;
  gameShow:          number;
  noTmdb:            number;
  secondaryTier:     number;
}

export function freshCapState(): CapState {
  return { anime: 0, realityNonfiction: 0, gameShow: 0, noTmdb: 0, secondaryTier: 0 };
}

/** Retorna true se o item pode entrar na seção dado o estado atual dos caps. */
export function checkCaps(
  scored: SectionScoreResult,
  caps: SectionCaps,
  state: CapState,
): boolean {
  if (scored.isAnime           && state.anime             >= caps.anime)             return false;
  if (scored.isGenericGameShow  && state.gameShow          >= caps.gameShow)          return false;
  if (scored.isRealityOrNonfiction && !scored.isGenericGameShow &&
      state.realityNonfiction  >= caps.realityNonfiction)                             return false;
  if (!scored.hasValidTmdb     && state.noTmdb            >= caps.noTmdb)            return false;
  if (scored.scoreTier === "secondary" && state.secondaryTier >= caps.secondaryTier) return false;
  return true;
}

/** Atualiza o estado dos caps após aceitar um item. */
export function consumeCap(
  scored: SectionScoreResult,
  state: CapState,
): void {
  if (scored.isAnime)              state.anime++;
  if (scored.isGenericGameShow)    state.gameShow++;
  else if (scored.isRealityOrNonfiction) state.realityNonfiction++;
  if (!scored.hasValidTmdb)        state.noTmdb++;
  if (scored.scoreTier === "secondary") state.secondaryTier++;
}

// ── Helpers de faixa visual ───────────────────────────────────────────────────

/** Retorna true se o item deve aparecer em Destaques */
export function isSpotlight(scored: SectionScoreResult): boolean {
  return scored.scoreTier === "spotlight";
}

/** Retorna true se o item deve aparecer nas seções principais */
export function isMainSection(scored: SectionScoreResult): boolean {
  return scored.scoreTier === "spotlight" || scored.scoreTier === "main";
}

/** Retorna true se o item deve aparecer em Também Relevantes */
export function isSecondarySection(scored: SectionScoreResult): boolean {
  return scored.scoreTier === "secondary";
}

/** Retorna true se o item deve ser ocultado (score insuficiente) */
export function isHiddenByScore(scored: SectionScoreResult): boolean {
  return scored.scoreTier === "hidden";
}

/** Retorna o label de seção para log/debug */
export function getSectionLabel(scored: SectionScoreResult): string {
  if (scored.scoreTier === "spotlight") return "Destaques";
  if (scored.scoreTier === "main")      return "Principal";
  if (scored.scoreTier === "secondary") return "Também Relevantes";
  return "Oculto";
}

/** Thresholds exportados para uso em outros módulos */
export { SCORE_THRESHOLDS, getScoreTier };

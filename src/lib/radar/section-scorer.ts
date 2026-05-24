// ── src/lib/radar/section-scorer.ts ─────────────────────────────────────────
// Score de SEÇÃO para o Radar Geral.
//
// Propósito distinto de computeUnifiedScore (src/lib/radar/score.ts):
//   computeUnifiedScore → score de qualidade intrínseca do título (popularidade,
//     qualidade de votos, rede, trending). Usado para ordenação global.
//
//   computeSectionScore → score de relevância TEMPORAL + editorial para
//     decidir em qual seção (Hoje / Semana / 30 dias) o item aparece e com
//     que prioridade. Combina temporalidade + qualidade + bônus/penalidades
//     editoriais.
//
// Fluxo:
//   bloqueio estrutural (já feito no pipeline) →
//   computeSectionScore (temporalidade + qualidade) →
//   buckets →
//   caps por seção (anime, reality, game show, sem TMDB) →
//   distribuição final
// ────────────────────────────────────────────────────────────────────────────

export type SectionBucket =
  | "todayStrict"      // data == hoje
  | "yesterdayStrong"  // data == ontem, score bom
  | "recentStrong"     // últimos 7d, score bom
  | "nearFuture"       // amanhã até +3d
  | "midFuture"        // +4d até +7d
  | "farFuture"        // +8d até +30d
  | "undated"          // sem data (trending/on_the_air sem nextAirDate)
  | "overflow";        // não coube em nenhuma seção relevante

export interface SectionScoreResult {
  bucket: SectionBucket;
  sectionScore: number;
  temporalBonus: number;
  qualityScore: number;
  isAnime: boolean;
  isRealityPremium: boolean;
  isGenericGameShow: boolean;
  hasValidTmdb: boolean;
}

// IDs de redes premium (HBO/Max, Apple, Netflix, Prime, Disney+, FX, Paramount+,
// Hulu, Showtime, AMC, BBC) — usados para detectar game show genérico
const PREMIUM_NETWORK_IDS = new Set([
  49,    // HBO
  2552,  // Apple TV+
  213,   // Netflix
  1024,  // Amazon Prime Video
  453,   // Hulu
  2739,  // Disney+
  3353,  // Max (HBO Max)
  6,     // FX
  4330,  // Paramount+
  67,    // Showtime
  174,   // AMC
  4,     // BBC One
  393,   // BBC Two
  1709,  // Canal+
  57,    // Peacock
  64,    // Sky One
  318,   // Starz
]);

// Bonus por temporalidade (dias relativos ao dia atual)
// Estes bônus são somados ao score base de qualidade para score de seção
function temporalBonus(daysFromToday: number | null): number {
  if (daysFromToday === null) return 5; // undated: bônus mínimo (on_the_air)
  if (daysFromToday === 0)   return 30; // hoje: urgência máxima
  if (daysFromToday === -1)  return 25; // ontem: ainda quente
  if (daysFromToday >= -7 && daysFromToday <= -2) return 15; // recente
  if (daysFromToday >= 1  && daysFromToday <= 3)  return 12; // futuro próximo
  if (daysFromToday >= 4  && daysFromToday <= 7)  return 8;  // futuro médio
  if (daysFromToday >= 8  && daysFromToday <= 30) return 4;  // futuro distante
  return 0; // fora da janela de 30 dias
}

function daysFromToday(dateStr: string | null | undefined, todayStr: string): number | null {
  if (!dateStr) return null;
  const d = dateStr.slice(0, 10);
  // Parse manual para evitar timezone issues
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const [ey, em, ed] = d.split("-").map(Number);
  const todayMs = Date.UTC(ty, tm - 1, td);
  const eventMs = Date.UTC(ey, em - 1, ed);
  return Math.round((eventMs - todayMs) / 86_400_000);
}

interface ScorerInput {
  category: string;
  relevanceScore: number;  // score de qualidade do computeUnifiedScore
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

const ANIME_GENRE_ID = 16; // Animation (used with ja language for anime detection)

export function computeSectionScore(
  item: ScorerInput,
  todayStr: string,
): SectionScoreResult {
  const hasValidTmdb = item.tmdb != null;
  const days = daysFromToday(item.nextAirDate, todayStr);
  const tBonus = temporalBonus(days);
  const qualityScore = item.relevanceScore ?? 0;
  const sectionScore = qualityScore + tBonus;

  // ── Classificadores internos ─────────────────────────────────────────────

  const lang = item.tmdb?.original_language ?? "";
  const genreIds = item.tmdb?.genre_ids ?? [];
  const isAnime = lang === "ja" && genreIds.includes(ANIME_GENRE_ID);

  const isRealityPremium = item.category === "REALITY_PREMIUM";

  // Game show genérico: REALITY_PREMIUM sem rede premium forte,
  // popularidade baixa, poucos votos — indica formato de quiz/variety fraco
  const networks = item.tmdb?.networks ?? [];
  const hasPremiumNet = networks.some((n) => PREMIUM_NETWORK_IDS.has(n.id));
  const pop = item.tmdb?.popularity ?? 0;
  const votes = item.tmdb?.vote_count ?? 0;
  const tmdbType = item.tmdb?.tmdb_type ?? "";
  const isGenericGameShow =
    isRealityPremium &&
    !hasPremiumNet &&
    pop < 40 &&
    votes < 300 &&
    tmdbType !== "Scripted"; // scripted não é game show

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
    isAnime,
    isRealityPremium,
    isGenericGameShow,
    hasValidTmdb,
  };
}

// ── Caps por seção ────────────────────────────────────────────────────────────

export interface SectionCaps {
  anime:          number;
  realityPremium: number;
  gameShow:       number;
  noTmdb:         number;
}

export const CAPS_TODAY: SectionCaps    = { anime: 2, realityPremium: 3, gameShow: 1, noTmdb: 2 };
export const CAPS_WEEK: SectionCaps     = { anime: 4, realityPremium: 4, gameShow: 2, noTmdb: 4 };
export const CAPS_MONTH: SectionCaps    = { anime: 4, realityPremium: 3, gameShow: 1, noTmdb: 2 };

export interface CapState {
  anime:          number;
  realityPremium: number;
  gameShow:       number;
  noTmdb:         number;
}

export function freshCapState(): CapState {
  return { anime: 0, realityPremium: 0, gameShow: 0, noTmdb: 0 };
}

/** Retorna true se o item pode entrar na seção dado o estado atual dos caps. */
export function checkCaps(
  scored: SectionScoreResult,
  caps: SectionCaps,
  state: CapState,
): boolean {
  if (scored.isAnime          && state.anime          >= caps.anime)          return false;
  if (scored.isGenericGameShow && state.gameShow       >= caps.gameShow)       return false;
  if (scored.isRealityPremium  && !scored.isGenericGameShow &&
      state.realityPremium    >= caps.realityPremium)                          return false;
  if (!scored.hasValidTmdb    && state.noTmdb          >= caps.noTmdb)        return false;
  return true;
}

/** Atualiza o estado dos caps após aceitar um item. */
export function consumeCap(
  scored: SectionScoreResult,
  state: CapState,
): void {
  if (scored.isAnime)          state.anime++;
  if (scored.isGenericGameShow) state.gameShow++;
  else if (scored.isRealityPremium) state.realityPremium++;
  if (!scored.hasValidTmdb)    state.noTmdb++;
}

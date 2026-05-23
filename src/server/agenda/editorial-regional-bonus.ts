/**
 * Bônus editorial para produções brasileiras.
 *
 * Problema: conteúdos nacionais dependem indiretamente de idioma PT ou da rede
 * associada, sem valorização real da origem da produção. Títulos brasileiros de
 * qualidade ficam subrepresentados no feed editorial em relação ao seu valor
 * cultural real.
 *
 * Solução: bônus específico para produções com `origin_country = ['BR']`,
 * aplicado como score aditivo normalizado para não distorcer o ranking global,
 * mas suficiente para elevar títulos BR de qualidade acima de conteúdo estrangeiro
 * mediano com popularidade similar.
 *
 * Exclusões editoriais (nunca recebem bônus BR):
 * - Novelas / Soap Opera (genre_id 10766)
 * - Reality shows (genre_id 10764)
 * - Talk shows (genre_id 10767)
 * - Noticiário / News (genre_id 10763)
 * - Game shows (genre_id 10764) — mesmo id que reality no TMDB
 *
 * Detecção de origem BR:
 * 1. `origin_country` array contém "BR" (campo do tmdb_payload)
 * 2. Fallback: `original_language === 'pt'` (proxy menos preciso mas mais disponível)
 *
 * O bônus é graduado pela qualidade do título (vote_average / popularidade)
 * para não promover produções nacionais de baixa qualidade.
 */

// ─── IDs de gênero TMDB bloqueados editorialmente ────────────────────────────

/** Gêneros que nunca recebem bônus regional, independentemente da origem. */
const BLOCKED_GENRE_IDS = new Set<number>([
  10766, // Soap opera / Novela
  10764, // Reality / Game show
  10767, // Talk show
  10763, // News / Noticiário
]);

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type RegionalBonusInput = {
  /**
   * Array de países de origem extraído do tmdb_payload.
   * Quando disponível, é a fonte mais confiável.
   */
  originCountry?: string[] | null;

  /**
   * Idioma original — usado como fallback quando originCountry não está disponível.
   * "pt" sinaliza forte probabilidade de produção BR (ou PT, mas aceitável).
   */
  originalLanguage?: string | null;

  /** IDs de gênero TMDB do título. */
  genreIds?: number[] | null;

  /**
   * Nota média do título (escala 0–10) para graduar o bônus.
   * Títulos com nota baixa recebem bônus menor.
   */
  voteAverage?: number | null;

  /**
   * Quantidade de votos. Títulos sem votos suficientes recebem bônus reduzido
   * (evita promover obscuridades sem validação de audiência).
   */
  voteCount?: number | null;
};

export type RegionalBonusResult = {
  /** Valor do bônus a ser somado ao score editorial (0 = sem bônus). */
  bonus: number;
  /** Motivo da concessão ou negação do bônus, para debug/auditoria. */
  reason: "origin_country_br" | "original_language_pt" | "not_eligible" | "blocked_genre";
  /** Se o título é considerado produção brasileira. */
  isBrazilianProduction: boolean;
};

// ─── Constantes de calibração ─────────────────────────────────────────────────

/** Bônus máximo por `origin_country = ['BR']` confirmado (escala do score editorial). */
const BONUS_ORIGIN_COUNTRY_MAX = 18;

/** Bônus máximo por fallback `original_language = 'pt'` (menos preciso, menor bônus). */
const BONUS_ORIGINAL_LANGUAGE_MAX = 8;

/**
 * Vote count mínimo para bônus completo. Abaixo disso, o bônus é proporcional.
 * Evita promover conteúdo BR sem validação mínima de audiência.
 */
const MIN_VOTE_COUNT_FULL_BONUS = 50;

/**
 * Vote count abaixo do qual o bônus é zero (sem validação de audiência).
 * Novos títulos com 0–4 votos não recebem bônus.
 */
const MIN_VOTE_COUNT_THRESHOLD = 5;

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Calcula o bônus editorial regional para produções brasileiras.
 *
 * @param input - Dados do título necessários para o cálculo.
 * @returns Resultado com o valor do bônus e metadados de auditoria.
 */
export function computeBrazilianProductionBonus(
  input: RegionalBonusInput,
): RegionalBonusResult {
  const NOT_ELIGIBLE: RegionalBonusResult = {
    bonus: 0,
    reason: "not_eligible",
    isBrazilianProduction: false,
  };

  // 1. Verificar exclusões por gênero
  const genreIds = input.genreIds ?? [];
  const hasBlockedGenre = genreIds.some((id) => BLOCKED_GENRE_IDS.has(id));
  if (hasBlockedGenre) {
    return {
      bonus: 0,
      reason: "blocked_genre",
      isBrazilianProduction: false,
    };
  }

  // 2. Detectar origem BR
  const hasOriginCountryBR =
    Array.isArray(input.originCountry) && input.originCountry.includes("BR");
  const hasPortugueseLanguage =
    !hasOriginCountryBR && input.originalLanguage === "pt";

  if (!hasOriginCountryBR && !hasPortugueseLanguage) {
    return NOT_ELIGIBLE;
  }

  // 3. Calcular fator de qualidade (0–1) baseado em voteAverage
  const voteAvg = input.voteAverage ?? 0;
  // Normaliza voteAverage de 0–10 → 0–1, com threshold mínimo de 5.0
  // Títulos abaixo de 5.0 recebem bônus mínimo (não zero, mas reduzido)
  const qualityFactor =
    voteAvg >= 5.0
      ? Math.min(1, (voteAvg - 5.0) / 5.0) * 0.8 + 0.2 // [0.2, 1.0]
      : 0.2; // Mínimo de 0.2 para não eliminar completamente

  // 4. Calcular fator de audiência baseado em voteCount
  const voteCount = input.voteCount ?? 0;
  let audienceFactor: number;
  if (voteCount < MIN_VOTE_COUNT_THRESHOLD) {
    audienceFactor = 0;
  } else if (voteCount >= MIN_VOTE_COUNT_FULL_BONUS) {
    audienceFactor = 1.0;
  } else {
    audienceFactor =
      (voteCount - MIN_VOTE_COUNT_THRESHOLD) /
      (MIN_VOTE_COUNT_FULL_BONUS - MIN_VOTE_COUNT_THRESHOLD);
  }

  // 5. Aplicar bônus graduado
  if (hasOriginCountryBR) {
    const bonus = Math.round(
      BONUS_ORIGIN_COUNTRY_MAX * qualityFactor * audienceFactor,
    );
    return {
      bonus,
      reason: "origin_country_br",
      isBrazilianProduction: true,
    };
  }

  // Fallback: idioma PT
  const bonus = Math.round(
    BONUS_ORIGINAL_LANGUAGE_MAX * qualityFactor * audienceFactor,
  );
  return {
    bonus,
    reason: "original_language_pt",
    isBrazilianProduction: true,
  };
}

/**
 * Extrai `origin_country` de um raw payload TMDB (quando disponível).
 * O TMDB retorna este campo como `string[]` nas respostas de detalhes
 * de /movie/{id} e /tv/{id}, mas não nas listagens discover/trending.
 */
export function extractOriginCountryFromPayload(
  rawPayload: Record<string, unknown> | null | undefined,
): string[] | null {
  if (!rawPayload) return null;
  const oc = rawPayload["origin_country"];
  if (Array.isArray(oc) && oc.every((c) => typeof c === "string")) {
    return oc as string[];
  }
  return null;
}

// ─── Bônus em arrays legados ──────────────────────────────────────────────────

/**
 * Contrato mínimo de um item legado para aplicação do bônus regional.
 * Compatível com AgendaTv, AgendaMovie, LegacyAgendaTv e LegacyAgendaMovie.
 */
export type LegacyBonusEligibleItem = {
  popularity: number;
  original_language?: string | null;
  genre_ids: number[];
  vote_average: number;
  vote_count: number;
  /** Preenchido pela própria função — não precisa existir antes. */
  editorial_score?: number;
  /** Bônus BR aplicado, para debug/transparência. */
  br_bonus?: number;
};

/**
 * Aplica bonus BR em arrays legados e reordena por editorial_score.
 * Reutiliza computeBrazilianProductionBonus() sem duplicar logica.
 *
 * @param items     - Array compativel com LegacyBonusEligibleItem.
 * @param normalize - normalizeTmdbPopularity injetado para evitar dependencia circular.
 * @returns Novo array com editorial_score/br_bonus e ordenado por editorial_score desc.
 */
export function applyLegacyBrazilianBonus<T extends LegacyBonusEligibleItem>(
  items: T[],
  normalize: (popularity: number | null | undefined) => number,
): T[] {
  return items
    .map((item) => {
      const normalizedPop = normalize(item.popularity) * 100;
      const brResult = computeBrazilianProductionBonus({
        originalLanguage: item.original_language,
        genreIds: item.genre_ids,
        voteAverage: item.vote_average,
        voteCount: item.vote_count,
      });
      const editorial_score = normalizedPop + brResult.bonus;
      return { ...item, editorial_score, br_bonus: brResult.bonus };
    })
    .sort((a, b) => (b.editorial_score ?? 0) - (a.editorial_score ?? 0));
}

/**
 * Editorial Balance Engine — engine global de balanceamento editorial.
 *
 * Objetivo: impedir que hype, trending ou conteúdos muito parecidos monopolizem
 * o feed visual por tempo excessivo, garantindo sensação de curadoria premium,
 * descoberta e variedade constante.
 *
 * Filosofia:
 * - As penalidades reduzem temporariamente a prioridade de exposição, mas NÃO
 *   alteram a relevância absoluta do título. O score original é preservado.
 * - Combinações de penalidades são multiplicativas, não destrutivas.
 * - Um título penalizado hoje pode recuperar posição no próximo ciclo.
 *
 * Penalidades aplicadas:
 *   recently_shown_penalty  — título apareceu recentemente no feed do usuário
 *   hero_decay              — item ocupou slot hero muitas vezes seguidas
 *   agenda_repeat_decay     — mesmo título repetido em múltiplas seções do feed
 *   diversity_penalty       — excesso de títulos do mesmo provider/gênero/idioma/franquia
 *
 * Saída: `editorialScore` = `score` × (produto das penalidades 0–1).
 */

import type { AgendaEvent } from "@/server/agenda/types";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type EditorialContext = {
  /**
   * Histórico de exposição por tmdbId, para calcular recently_shown_penalty
   * e hero_decay. A chave é `${mediaType}-${tmdbId}`.
   */
  recentlyShown?: Map<string, RecentlyShownEntry>;

  /**
   * Conjunto de tmdbIds já posicionados neste ciclo de composição
   * (uma passagem pelo compose()), para calcular agenda_repeat_decay.
   */
  composedInThisCycle?: Set<string>;

  /**
   * Contexto de diversidade acumulado — contadores de providers, gêneros,
   * idiomas e franquias já presentes no feed composto.
   */
  diversity?: DiversityContext;

  /**
   * Timestamp de "agora" usado para calcular decaimento temporal.
   * Default: Date.now().
   */
  now?: number;
};

export type RecentlyShownEntry = {
  /** Quantas vezes o título foi exibido no total (posição hero ou card). */
  totalShown: number;
  /** Quantas vezes ocupou slot hero especificamente. */
  heroShown: number;
  /** Unix timestamp (ms) da última aparição. */
  lastShownAt: number;
};

export type DiversityContext = {
  providerCounts: Map<string, number>;
  genreCounts: Map<number, number>;
  languageCounts: Map<string, number>;
  franchiseCounts: Map<string, number>;
};

export type EditorialPenaltyBreakdown = {
  recently_shown_penalty: number;
  hero_decay: number;
  agenda_repeat_decay: number;
  diversity_penalty: number;
  /** Produto final de todas as penalidades (0–1). */
  combined: number;
};

export type EditorialScoredEvent = AgendaEvent & {
  /** Score original inalterado. */
  originalScore: number;
  /** Score após aplicação das penalidades editoriais. */
  editorialScore: number;
  /** Breakdown detalhado das penalidades para debug/auditoria. */
  editorialPenalties: EditorialPenaltyBreakdown;
};

// ─── Constantes de calibração ─────────────────────────────────────────────────

/** Intervalo mínimo (ms) entre exibições de um mesmo título sem penalidade. */
const RECENTLY_SHOWN_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 horas

/** Penalidade mínima aplicada a títulos vistos há < 6h (nunca zera). */
const RECENTLY_SHOWN_MIN = 0.35;

/** Cada aparição hero acumula este fator de penalidade. */
const HERO_DECAY_PER_SHOW = 0.12;

/** Penalidade mínima para hero_decay (nunca elimina o título). */
const HERO_DECAY_MIN = 0.30;

/** Penalidade aplicada quando o título já apareceu neste ciclo de composição. */
const AGENDA_REPEAT_PENALTY = 0.50;

/** Limite de itens de um mesmo provider antes de penalizar. */
const PROVIDER_DIVERSITY_THRESHOLD = 3;

/** Fator de penalidade de diversidade por excedente. */
const DIVERSITY_PENALTY_FACTOR = 0.15;

// ─── Penalidades individuais ──────────────────────────────────────────────────

function computeRecentlyShownPenalty(
  key: string,
  recentlyShown: Map<string, RecentlyShownEntry> | undefined,
  now: number,
): number {
  if (!recentlyShown) return 1.0;
  const entry = recentlyShown.get(key);
  if (!entry) return 1.0;

  const elapsedMs = now - entry.lastShownAt;
  if (elapsedMs >= RECENTLY_SHOWN_WINDOW_MS) return 1.0;

  // Penalidade decresce linearmente conforme o tempo passa dentro da janela
  const ratio = elapsedMs / RECENTLY_SHOWN_WINDOW_MS;
  return Math.max(RECENTLY_SHOWN_MIN, RECENTLY_SHOWN_MIN + (1 - RECENTLY_SHOWN_MIN) * ratio);
}

function computeHeroDecay(
  key: string,
  recentlyShown: Map<string, RecentlyShownEntry> | undefined,
  isHeroCandidate: boolean,
): number {
  if (!isHeroCandidate || !recentlyShown) return 1.0;
  const entry = recentlyShown.get(key);
  if (!entry || entry.heroShown === 0) return 1.0;

  const decay = 1 - HERO_DECAY_PER_SHOW * entry.heroShown;
  return Math.max(HERO_DECAY_MIN, decay);
}

function computeAgendaRepeatDecay(
  key: string,
  composedInThisCycle: Set<string> | undefined,
): number {
  if (!composedInThisCycle) return 1.0;
  return composedInThisCycle.has(key) ? AGENDA_REPEAT_PENALTY : 1.0;
}

function computeDiversityPenalty(
  event: AgendaEvent,
  diversity: DiversityContext | undefined,
): number {
  if (!diversity) return 1.0;

  let penalty = 1.0;

  // Provider
  if (event.provider?.name) {
    const count = diversity.providerCounts.get(event.provider.name) ?? 0;
    if (count >= PROVIDER_DIVERSITY_THRESHOLD) {
      const excess = count - PROVIDER_DIVERSITY_THRESHOLD + 1;
      penalty *= Math.max(0.2, 1 - DIVERSITY_PENALTY_FACTOR * excess);
    }
  }

  // Gêneros (penaliza se qualquer gênero do item está super-representado)
  // AgendaEvent não carrega genre_ids diretamente — toleramos a ausência.
  // Se no futuro o tipo for estendido, basta descomentar:
  // if (event.genreIds) {
  //   for (const genreId of event.genreIds) {
  //     const count = diversity.genreCounts.get(genreId) ?? 0;
  //     if (count >= GENRE_DIVERSITY_THRESHOLD) {
  //       const excess = count - GENRE_DIVERSITY_THRESHOLD + 1;
  //       penalty *= Math.max(0.3, 1 - DIVERSITY_PENALTY_FACTOR * excess);
  //     }
  //   }
  // }

  return Math.max(0.15, penalty);
}

// ─── Engine principal ─────────────────────────────────────────────────────────

export class EditorialBalanceEngine {
  /**
   * Aplica as penalidades editoriais em um conjunto de eventos já pontuados,
   * retornando-os com `editorialScore` e `editorialPenalties` adicionados.
   *
   * @param events  - Eventos com `score` já calculado.
   * @param context - Contexto de histórico e diversidade.
   */
  applyPenalties(
    events: AgendaEvent[],
    context: EditorialContext = {},
  ): EditorialScoredEvent[] {
    const now = context.now ?? Date.now();

    return events.map((event) => {
      const key = `${event.mediaType}-${event.tmdbId}`;
      const isHeroCandidate = event.visualWeight === "hero";

      const recently_shown_penalty = computeRecentlyShownPenalty(
        key,
        context.recentlyShown,
        now,
      );

      const hero_decay = computeHeroDecay(
        key,
        context.recentlyShown,
        isHeroCandidate,
      );

      const agenda_repeat_decay = computeAgendaRepeatDecay(
        key,
        context.composedInThisCycle,
      );

      const diversity_penalty = computeDiversityPenalty(
        event,
        context.diversity,
      );

      const combined =
        recently_shown_penalty * hero_decay * agenda_repeat_decay * diversity_penalty;

      return {
        ...event,
        originalScore: event.score,
        editorialScore: event.score * combined,
        editorialPenalties: {
          recently_shown_penalty,
          hero_decay,
          agenda_repeat_decay,
          diversity_penalty,
          combined,
        },
      };
    });
  }

  /**
   * Aplica penalidades e ordena o resultado por `editorialScore` decrescente.
   */
  rankEditorial(
    events: AgendaEvent[],
    context: EditorialContext = {},
  ): EditorialScoredEvent[] {
    return this.applyPenalties(events, context).sort(
      (a, b) => b.editorialScore - a.editorialScore,
    );
  }

  /**
   * Após selecionar um evento para o feed, registra a exposição no contexto
   * para que as próximas chamadas da mesma sessão de composição reflitam
   * o estado atualizado.
   *
   * Atualiza `composedInThisCycle` e (se fornecido) `recentlyShown`.
   */
  recordExposure(
    event: AgendaEvent,
    context: EditorialContext,
    opts: { isHero?: boolean } = {},
  ): void {
    const key = `${event.mediaType}-${event.tmdbId}`;
    const now = context.now ?? Date.now();

    // Registra no ciclo atual
    if (context.composedInThisCycle) {
      context.composedInThisCycle.add(key);
    }

    // Atualiza histórico persistido (se disponível)
    if (context.recentlyShown) {
      const existing = context.recentlyShown.get(key) ?? {
        totalShown: 0,
        heroShown: 0,
        lastShownAt: 0,
      };
      context.recentlyShown.set(key, {
        totalShown: existing.totalShown + 1,
        heroShown: existing.heroShown + (opts.isHero ? 1 : 0),
        lastShownAt: now,
      });
    }

    // Atualiza contadores de diversidade
    if (context.diversity) {
      if (event.provider?.name) {
        const c = context.diversity.providerCounts.get(event.provider.name) ?? 0;
        context.diversity.providerCounts.set(event.provider.name, c + 1);
      }
    }
  }

  /**
   * Cria um contexto de diversidade zerado para o início de um ciclo
   * de composição.
   */
  createDiversityContext(): DiversityContext {
    return {
      providerCounts: new Map(),
      genreCounts: new Map(),
      languageCounts: new Map(),
      franchiseCounts: new Map(),
    };
  }
}

export const editorialBalanceEngine = new EditorialBalanceEngine();

/**
 * coming-soon.ts — regra CANÔNICA e ÚNICA de "Em breve".
 *
 * Camada centralizada de disponibilidade: decide se um título é "Em breve" a partir
 * dos summaries JÁ normalizados pelo fluxo canônico
 *   fonte externa → catalog_availability → getTitleAvailability/hydrateManyTitleAvailability → front-end
 *
 * Nenhuma superfície (Biblioteca, Home, etc.) deve recriar esta regra nem consultar
 * providers por conta própria: todas consomem `resolveComingSoon`.
 *
 * "Em breve" representa APENAS títulos realmente futuros ou ainda dentro de uma janela
 * válida de chegada ao VOD/streaming. Prioridade de verificação: BR → US → fallback.
 */

import type { TitleAvailabilitySummary } from "./availability-types";

const DAY_MS = 86_400_000;

/** Janela máxima (dias) após a estreia em que um filme theatrical sem VOD ainda pode ficar "Em breve". */
export const THEATRICAL_VOD_WINDOW_DAYS = 120;

export type ComingSoonPhase = "pre_release" | "awaiting_vod" | "critical_recheck";

export type ComingSoonInfo = {
  isComingSoon: boolean;
  phase: ComingSoonPhase | null;
  /** Data a exibir (lançamento futuro ou VOD previsto), quando houver. */
  displayDate: string | null;
};

export const NOT_COMING_SOON: ComingSoonInfo = {
  isComingSoon: false,
  phase: null,
  displayDate: null,
};

export type ComingSoonInput = {
  mediaType: "movie" | "tv";
  /** Disponibilidade BR normalizada — prioridade 1. */
  availabilityBR?: TitleAvailabilitySummary | null;
  /** Disponibilidade US normalizada — prioridade 2 (apoio). */
  availabilityUS?: TitleAvailabilitySummary | null;
  /** Data de lançamento/estreia confirmada do título — prioridade 3 (fallback). */
  confirmedReleaseDate?: string | null;
};

function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** Disponibilidade válida = há oferta em qualquer lugar OU estado resolvido como disponível. */
function isAvailable(summary?: TitleAvailabilitySummary | null): boolean {
  if (!summary) return false;
  return summary.status.isAvailableSomewhere === true || summary.state === "available";
}

type ReleaseBlock = TitleAvailabilitySummary["release"];

function isUsefulRelease(release?: ReleaseBlock | null): release is ReleaseBlock {
  return (
    !!release &&
    (release.kind !== "unknown" ||
      !!release.theatricalDate ||
      !!release.expectedVodDate ||
      !!release.earliestRelevantDate)
  );
}

/** Escolhe o bloco `release` canônico com prioridade BR → US (fallback: o que existir). */
function pickRelease(input: ComingSoonInput): ReleaseBlock | null {
  const br = input.availabilityBR?.release;
  const us = input.availabilityUS?.release;
  if (isUsefulRelease(br)) return br;
  if (isUsefulRelease(us)) return us;
  return br ?? us ?? null;
}

/** Flag de status presente em BR OU US (BR tem prioridade, mas US serve de apoio). */
function anyStatus(input: ComingSoonInput, key: "isInTheaters" | "isFutureRelease"): boolean {
  return (
    input.availabilityBR?.status[key] === true ||
    input.availabilityUS?.status[key] === true
  );
}

/**
 * Decisão canônica de "Em breve".
 *
 * Ordem da regra:
 *  1. Disponibilidade válida (BR → US) encerra "Em breve" imediatamente.
 *  2. Ainda não lançado → "Em breve" (pre_release). Séries: até o 1º episódio.
 *  3. Série já lançada (1º episódio no ar) → sai de "Em breve" (temporadas futuras
 *     são tratadas por Acompanhando/Agenda, não por este status).
 *  4. Filme em cartaz sem VOD → "Em breve" até D+120 (exibe VOD previsto, se houver).
 *  5. Lançamento direto em VOD/streaming → revalidação crítica em D+0..D+1.
 *  6. Caso contrário (catálogo antigo, sem data, janela expirada) → nunca "Em breve".
 *     Ausência de provider vira "sem disponibilidade encontrada" na superfície.
 */
export function resolveComingSoon(input: ComingSoonInput, now = Date.now()): ComingSoonInfo {
  // 1. Prioridade BR → US: qualquer disponibilidade válida encerra "Em breve".
  //    US-disponível-mas-não-BR também sai de "Em breve"; a superfície decide se
  //    exibe "indisponível no Brasil" (via availability_us). Nunca "data a confirmar".
  if (isAvailable(input.availabilityBR) || isAvailable(input.availabilityUS)) {
    return NOT_COMING_SOON;
  }

  const release = pickRelease(input);
  const confirmedDate = input.confirmedReleaseDate ?? null;
  const releaseDate = release?.earliestRelevantDate ?? confirmedDate;
  const releaseTime = timestamp(releaseDate);
  const expectedVodDate = release?.expectedVodDate ?? null;
  const expectedVodTime = timestamp(expectedVodDate);

  // 2. Ainda não lançado → "Em breve". Vale para filmes e séries (séries até o 1º episódio).
  if (releaseTime !== null && releaseTime > now) {
    return { isComingSoon: true, phase: "pre_release", displayDate: releaseDate };
  }
  if (anyStatus(input, "isFutureRelease")) {
    return {
      isComingSoon: true,
      phase: "pre_release",
      displayDate: releaseDate ?? expectedVodDate,
    };
  }

  // A partir daqui o título já passou da data de lançamento/estreia conhecida.

  // 3. Séries: assim que o 1º episódio é lançado, saem de "Em breve".
  //    Temporadas futuras são responsabilidade de Acompanhando/Agenda.
  if (input.mediaType === "tv") {
    return NOT_COMING_SOON;
  }

  // 4. Filme em cartaz (theatrical) sem VOD: pode permanecer "Em breve" até D+120.
  const theatricalDate =
    release?.theatricalDate ?? (anyStatus(input, "isInTheaters") ? confirmedDate : null);
  const theatricalTime = timestamp(theatricalDate);
  const theatricalAgeDays = theatricalTime === null ? null : (now - theatricalTime) / DAY_MS;
  const isTheatrical =
    release?.kind === "theatrical" ||
    theatricalTime !== null ||
    anyStatus(input, "isInTheaters");

  if (
    isTheatrical &&
    theatricalAgeDays !== null &&
    theatricalAgeDays >= 0 &&
    theatricalAgeDays <= THEATRICAL_VOD_WINDOW_DAYS
  ) {
    // Se houver data prevista de VOD, exibe-a; mantém "Em breve" até o VOD/D+120.
    return {
      isComingSoon: true,
      phase: "awaiting_vod",
      displayDate: expectedVodTime !== null ? expectedVodDate : null,
    };
  }

  // 5. Lançamento direto em VOD/streaming: revalida a partir da própria data de
  //    lançamento — uma única janela crítica em D+0..D+1. Depois, ausência de oferta
  //    é indisponibilidade, não "Em breve".
  const directRelease = release?.kind === "direct_vod" || release?.kind === "direct_streaming";
  const directAgeDays = releaseTime === null ? null : (now - releaseTime) / DAY_MS;
  if (directRelease && directAgeDays !== null && directAgeDays >= 0 && directAgeDays <= 1) {
    return {
      isComingSoon: true,
      phase: "critical_recheck",
      displayDate: expectedVodDate ?? releaseDate,
    };
  }

  // 6. Catálogo antigo, sem data, ou janela theatrical expirada → nunca "Em breve".
  //    Títulos antigos não entram só por falta de provider; expirados não retornam.
  return NOT_COMING_SOON;
}

/** Janela (dias) de fallback SEGURO de "Nos cinemas" sem confirmacao de cinema ativo. */
export const THEATRICAL_SAFE_FALLBACK_DAYS = 90;

export type TheatricalDisplay = {
  /** Exibir "Nos cinemas" como rotulo PRINCIPAL de disponibilidade. */
  inTheaters: boolean;
  /**
   * Origem do estado:
   *   - "signal"   -> a API confirma cinema/theatrical ativo agora (vale ate apos D+120).
   *   - "fallback" -> sem confirmacao; janela temporal segura (D+0..D+90) a partir da estreia.
   *   - "none"     -> nao exibir "Nos cinemas".
   */
  source: "signal" | "fallback" | "none";
};

export const NOT_IN_THEATERS: TheatricalDisplay = { inTheaters: false, source: "none" };

/**
 * Decisao canonica de "Nos cinemas" (rotulo de disponibilidade ATUAL, nao tipo
 * historico de lancamento). Consome os mesmos summaries normalizados.
 *
 * Regra:
 *  - So filmes.
 *  - Disponibilidade digital no BR (ou US) tem PRIORIDADE sobre "Nos cinemas".
 *  - Sinal explicito de cinema ativo (isInTheaters) -> "Nos cinemas" (vale inclusive apos D+120).
 *  - Sem confirmacao, mas com evidencia theatrical -> fallback temporal:
 *      - D+0..D+90   -> "Nos cinemas" (fallback seguro);
 *      - D+91..D+120 -> so com sinal ativo (cai no ramo acima); senao, sem rotulo
 *        (a superficie pode exibir "sem disponibilidade digital encontrada");
 *      - > D+120     -> nunca por fallback.
 *  - Lancamentos diretos em VOD/streaming NUNCA viram "Nos cinemas".
 */
export function resolveTheatricalStatus(input: ComingSoonInput, now = Date.now()): TheatricalDisplay {
  if (input.mediaType !== "movie") return NOT_IN_THEATERS;

  // Disponibilidade digital (BR -> US) tem prioridade sobre o rotulo "Nos cinemas".
  if (isAvailable(input.availabilityBR) || isAvailable(input.availabilityUS)) {
    return NOT_IN_THEATERS;
  }

  // Sinal atual e explicito de cinema ativo: evidencia atualizada, vale ate apos D+120.
  if (anyStatus(input, "isInTheaters")) {
    return { inTheaters: true, source: "signal" };
  }

  // Sem confirmacao de cinema ativo -> fallback temporal, apenas com evidencia theatrical
  // (lancamentos diretos em VOD/streaming nao geram "Nos cinemas").
  const release = pickRelease(input);
  const kind = release?.kind ?? "unknown";
  const isDirect = kind === "direct_vod" || kind === "direct_streaming";
  if (isDirect) return NOT_IN_THEATERS;

  const theatricalDate = release?.theatricalDate ?? input.confirmedReleaseDate ?? null;
  const theatricalTime = timestamp(theatricalDate);
  const hasTheatricalEvidence = kind === "theatrical" || theatricalTime !== null;
  if (!hasTheatricalEvidence || theatricalTime === null) return NOT_IN_THEATERS;

  const ageDays = (now - theatricalTime) / DAY_MS;
  if (ageDays >= 0 && ageDays <= THEATRICAL_SAFE_FALLBACK_DAYS) {
    return { inTheaters: true, source: "fallback" };
  }
  return NOT_IN_THEATERS;
}

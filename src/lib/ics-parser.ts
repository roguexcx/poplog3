// ── ICS Parser ────────────────────────────────────────────────────────────────
// Parseia feeds iCalendar (.ics) e retorna eventos estruturados.
// Suporta o formato do bancodeseries.com.br/ical.php
//
// Formato do SUMMARY esperado:
//   "Nome da Série  (Sx##): Nome do Episódio"
//   "Nome da Série  (Sx##): TBA"
// ──────────────────────────────────────────────────────────────────────────────

export interface IcsEvent {
  uid: string;
  /** Nome da série, limpo (sem encoding HTML) */
  seriesTitle: string;
  /** Código de temporada/episódio, ex: "1x36" */
  seasonEp: string;
  /** Número da temporada como inteiro */
  season: number;
  /** Número do episódio como inteiro */
  episode: number;
  /** Nome do episódio (pode ser "TBA" ou vazio) */
  episodeName: string;
  /** Data/hora de início em UTC */
  startAt: Date;
  /** Data/hora de fim em UTC */
  endAt: Date;
  /** String original do SUMMARY (para debug) */
  rawSummary: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Decodifica entidades HTML simples presentes no feed */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/**
 * Converte uma string DTSTART/DTEND do iCal para um objeto Date.
 * Formatos suportados:
 *   - 20260602T100000Z  (UTC)
 *   - 20260602          (date-only → meia-noite UTC)
 */
function parseIcsDate(value: string): Date {
  const clean = value.trim();

  if (clean.length === 8) {
    // date-only: YYYYMMDD
    const y = Number(clean.slice(0, 4));
    const m = Number(clean.slice(4, 6)) - 1;
    const d = Number(clean.slice(6, 8));
    return new Date(Date.UTC(y, m, d));
  }

  // datetime: YYYYMMDDTHHmmssZ ou YYYYMMDDTHHmmss
  const y = Number(clean.slice(0, 4));
  const mo = Number(clean.slice(4, 6)) - 1;
  const d = Number(clean.slice(6, 8));
  const h = Number(clean.slice(9, 11));
  const mi = Number(clean.slice(11, 13));
  const s = Number(clean.slice(13, 15));
  return new Date(Date.UTC(y, mo, d, h, mi, s));
}

/**
 * Parseia o SUMMARY no formato:
 *   "Nome da Série  (SxEE): Nome do Episódio"
 *   "(SxEE): Nome do Episódio"   ← série sem nome (edge case do feed)
 *
 * Retorna null se o formato não bater de jeito nenhum.
 */
function parseSummary(raw: string): {
  seriesTitle: string;
  season: number;
  episode: number;
  seasonEp: string;
  episodeName: string;
} | null {
  // Regex flexível: título opcional, temporada, episódio e nome do ep.
  // Exemplo: "The Heir  (1x36): Ep. 1x36"
  //          "Bear Grylls is Running Wild  (1x7): Bear with Rhys Darby"
  //          "(1x11): Ep. 1x11"  ← sem título (feed às vezes omite)
  const match = raw.match(/^(.*?)\s*\((\d+)x(\d+)\):\s*(.*)$/i);
  if (!match) return null;

  const [, rawTitle, rawSeason, rawEpisode, rawEpName] = match;
  const season = parseInt(rawSeason, 10);
  const episode = parseInt(rawEpisode, 10);
  const seriesTitle = decodeHtmlEntities(rawTitle.trim()) || `Série ${season}x${rawEpisode}`;

  return {
    seriesTitle,
    season,
    episode,
    seasonEp: `${season}x${episode.toString().padStart(2, "0")}`,
    episodeName: decodeHtmlEntities(rawEpName.trim()),
  };
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parseia o conteúdo bruto de um arquivo .ics e retorna um array de IcsEvent.
 * Eventos com SUMMARY que não batem no formato esperado são ignorados.
 */
export function parseIcsContent(raw: string): IcsEvent[] {
  const events: IcsEvent[] = [];

  // Normaliza quebras de linha e junta linhas dobradas (RFC 5545 line folding)
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, ""); // unfold

  // Divide em blocos VEVENT
  const blocks = normalized.split("BEGIN:VEVENT").slice(1);

  for (const block of blocks) {
    const end = block.indexOf("END:VEVENT");
    const body = end >= 0 ? block.slice(0, end) : block;

    const lines = body.split("\n");
    const props: Record<string, string> = {};

    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const key = line.slice(0, colon).split(";")[0].toUpperCase().trim();
      const val = line.slice(colon + 1).trim();
      props[key] = val;
    }

    const uid = props["UID"] ?? "";
    const rawSummary = props["SUMMARY"] ?? "";
    const rawStart = props["DTSTART"] ?? "";
    const rawEnd = props["DTEND"] ?? "";

    if (!rawSummary || !rawStart) continue;

    const parsed = parseSummary(rawSummary);
    if (!parsed) continue;

    events.push({
      uid,
      ...parsed,
      startAt: parseIcsDate(rawStart),
      endAt: rawEnd ? parseIcsDate(rawEnd) : parseIcsDate(rawStart),
      rawSummary,
    });
  }

  // Ordena por data de início
  return events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

// ── Utilitários de agrupamento ────────────────────────────────────────────────

/** Agrupa eventos por data (YYYY-MM-DD) em UTC */
export function groupByDay(events: IcsEvent[]): Map<string, IcsEvent[]> {
  const map = new Map<string, IcsEvent[]>();
  for (const ev of events) {
    const key = ev.startAt.toISOString().slice(0, 10);
    const arr = map.get(key) ?? [];
    arr.push(ev);
    map.set(key, arr);
  }
  return map;
}

/** Retorna eventos de uma semana (7 dias a partir de startDate, inclusive) */
export function eventsInWeek(
  events: IcsEvent[],
  startDate: Date
): IcsEvent[] {
  const start = new Date(startDate);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return events.filter(
    (e) => e.startAt >= start && e.startAt < end
  );
}

/** Retorna eventos de um dia específico (YYYY-MM-DD) */
export function eventsOnDay(
  events: IcsEvent[],
  dateStr: string
): IcsEvent[] {
  return events.filter(
    (e) => e.startAt.toISOString().slice(0, 10) === dateStr
  );
}

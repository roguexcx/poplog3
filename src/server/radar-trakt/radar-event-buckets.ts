import type { RadarBucketId, RadarEvent, RadarSection } from "./types";
import { addDays, dayDiff, isRecurringLowShow, showcaseTypeKey, toDateStr } from "./radar-event-utils";

const SECTION_META: Record<RadarBucketId, { title: string; description: string }> = {
  now: { title: "Agora", description: "Saiu ontem, sai hoje e chega amanhã." },
  highlights: { title: "Destaques", description: "Eventos fortes da janela imediata." },
  week: { title: "Esta semana", description: "Próximos dias com data confirmada." },
  next: { title: "Próximos", description: "Futuros lançamentos confirmados." },
  recent: { title: "Ainda em tempo", description: "Lançamentos recentes que podem ter passado batido." },
  anticipated: { title: "Mais aguardados", description: "Sinais editoriais do Trakt para ficar de olho." },
};

export function bucketForEvent(event: RadarEvent): RadarBucketId | null {
  if (event.bucket === "anticipated") return "anticipated";
  const diff = dayDiff(event.date);
  if (diff >= -1 && diff <= 1) return "now";
  if (diff >= 2 && diff <= 10) return "week";
  if (diff >= 11 && diff <= 31) return "next";
  if (diff >= -30 && diff <= -2) return "recent";
  return null;
}

function windowFor(id: RadarBucketId) {
  const today = new Date();
  if (id === "anticipated") return { start: null, end: null };
  if (id === "now") return { start: toDateStr(addDays(today, -1)), end: toDateStr(addDays(today, 1)) };
  if (id === "highlights") return { start: toDateStr(addDays(today, -3)), end: toDateStr(addDays(today, 3)) };
  if (id === "week") return { start: toDateStr(addDays(today, 2)), end: toDateStr(addDays(today, 10)) };
  if (id === "next") return { start: toDateStr(addDays(today, 11)), end: toDateStr(addDays(today, 31)) };
  return { start: toDateStr(addDays(today, -30)), end: toDateStr(addDays(today, -2)) };
}

export function buildRadarSections(events: RadarEvent[]): Record<RadarBucketId, RadarSection> {
  const withBuckets = events.map((event) => ({ ...event, bucket: bucketForEvent(event) })).filter((event) => event.bucket);
  const highlights = withBuckets
    .filter((event) => {
      const diff = dayDiff(event.date);
      return diff >= -3 && diff <= 3 && event.bucket !== "anticipated" && isShowcaseEligible(event);
    })
    .sort((a, b) => b.score - a.score)
    .filter(showcaseLimiter())
    .slice(0, 14)
    .map((event) => ({ ...event, bucket: "highlights" as const }));

  const sections = {} as Record<RadarBucketId, RadarSection>;
  for (const id of ["now", "highlights", "week", "next", "recent", "anticipated"] as RadarBucketId[]) {
    const items =
      id === "highlights"
        ? highlights
        : withBuckets.filter((event) => event.bucket === id).sort((a, b) => {
            if (id === "recent" || id === "anticipated") return b.score - a.score;
            return a.date.localeCompare(b.date) || b.score - a.score;
          });
    sections[id] = {
      id,
      title: SECTION_META[id].title,
      description: SECTION_META[id].description,
      items,
      count: items.length,
      window: windowFor(id),
    };
  }
  return sections;
}

function isShowcaseEligible(event: RadarEvent): boolean {
  if (!event.poster && !event.backdrop) return false;
  if (event.eventType === "unknown_dated_event") return false;
  if (isRecurringLowShow(event.contentType, event.title)) {
    return event.score >= 58 && Math.abs(dayDiff(event.date)) <= 1;
  }
  return true;
}

function showcaseLimiter() {
  const limits = new Map<string, number>([
    ["talk_news", 2],
    ["sports_live", 2],
    ["soap_daily", 2],
    ["reality", 4],
    ["animation_anime", 4],
  ]);
  const used = new Map<string, number>();
  return (event: RadarEvent) => {
    const key = showcaseTypeKey(event.contentType, event.title);
    const limit = limits.get(key);
    if (!limit) return true;
    const count = used.get(key) ?? 0;
    if (count >= limit) return false;
    used.set(key, count + 1);
    return true;
  };
}

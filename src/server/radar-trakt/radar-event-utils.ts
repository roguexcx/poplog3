import type { RadarContentType, RadarEventType } from "./types";

export function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d;
}

export function dayDiff(date: string, base = new Date()): number {
  const target = new Date(`${date.slice(0, 10)}T12:00:00.000Z`).getTime();
  const today = new Date(`${toDateStr(base)}T12:00:00.000Z`).getTime();
  return Math.round((target - today) / 86_400_000);
}

export function normalizeTextKey(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function relativeDateLabel(date: string, base = new Date()): string {
  const diff = dayDiff(date, base);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  if (diff < -1) return `Saiu há ${Math.abs(diff)} dias`;
  if (diff <= 6) return `Em ${diff} dias`;
  return new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
  });
}

export function labelForEvent(type: RadarEventType, count?: number | null): string {
  const labels: Record<RadarEventType, string> = {
    new_show: "Nova série",
    season_premiere: "Estreia de temporada",
    episode: "Novo episódio",
    multiple_episodes: `${count ?? "Vários"} episódios`,
    season_drop: "Temporada completa",
    season_finale: "Final de temporada",
    series_finale: "Final da série",
    movie_theatrical: "Nos cinemas",
    movie_digital: "Digital",
    movie_streaming: "Streaming",
    movie_physical: "Mídia física",
    movie_tv: "TV",
    movie_limited: "Lançamento limitado",
    movie_premiere: "Premiere",
    anticipated_with_date: "Em breve",
    recent_release: "Ainda em tempo",
    unknown_dated_event: "Evento com data",
  };
  return labels[type];
}

export function contentTypeFromGenres(genres: string[] | null | undefined, media: "show" | "movie"): RadarContentType {
  const normalized = new Set((genres ?? []).map(normalizeTextKey));
  const joined = [...normalized].join(" ");
  if (normalized.has("anime")) return "anime";
  if (joined.includes("animation") || joined.includes("animacao")) return "animation";
  if (joined.includes("documentary") || joined.includes("documentario")) return "documentary";
  if (joined.includes("soap")) return "soap";
  if (joined.includes("reality") || joined.includes("game show") || joined.includes("game-show")) return "reality";
  if (joined.includes("talk show") || joined.includes("talk-show") || normalized.has("talk")) return "talk_show";
  if (joined.includes("news") || joined.includes("noticias")) return "news";
  if (joined.includes("sport") || joined.includes("sports") || joined.includes("wrestling") || joined.includes("mma")) return "sports";
  if (joined.includes("children") || joined.includes("kids") || joined.includes("familia")) return "kids";
  if (media === "movie") return "movie";
  return "series";
}

export function isRecurringLowShow(contentType: RadarContentType, title: string): boolean {
  const key = normalizeTextKey(title);
  return (
    contentType === "talk_show" ||
    contentType === "news" ||
    contentType === "sports" ||
    contentType === "soap" ||
    key.includes("tonight show") ||
    key.includes("late show") ||
    key.includes("late night") ||
    key.includes("daily show") ||
    key.includes("good morning") ||
    key.includes("wwe") ||
    key.includes("raw") && key.includes("wwe") ||
    key.includes("smackdown") ||
    key.includes("general hospital") ||
    key.includes("days of our lives") ||
    key.includes("young and the restless") ||
    key.includes("bold and the beautiful")
  );
}

export function showcaseTypeKey(contentType: RadarContentType, title: string): string {
  const key = normalizeTextKey(title);
  if (contentType === "talk_show" || contentType === "news") return "talk_news";
  if (contentType === "sports" || contentType === "live_event" || key.includes("wwe") || key.includes("smackdown")) return "sports_live";
  if (contentType === "soap" || key.includes("general hospital") || key.includes("days of our lives")) return "soap_daily";
  if (contentType === "reality") return "reality";
  if (contentType === "animation" || contentType === "anime") return "animation_anime";
  if (contentType === "movie") return "movie";
  return contentType;
}

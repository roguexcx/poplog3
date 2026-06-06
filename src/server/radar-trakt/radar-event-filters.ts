import type { RadarFilter, RadarPayload } from "./types";

const FILTER_LABELS: Record<string, string> = {
  series: "Séries",
  movie: "Filmes",
  animation: "Animação",
  anime: "Anime",
  documentary: "Documentários",
  reality: "Reality",
  sports: "Esportes",
  talk_show: "Talk/News",
  news: "Talk/News",
  kids: "Infantil",
  live_event: "Eventos ao vivo",
  new_show: "Estreias",
  season_premiere: "Estreias",
  episode: "Novos episódios",
  multiple_episodes: "Novos episódios",
  season_drop: "Temporadas completas",
  season_finale: "Finais",
  series_finale: "Finais",
  movie_theatrical: "Cinema",
  movie_streaming: "Streaming/Digital",
  movie_digital: "Streaming/Digital",
  movie_physical: "Mídia física",
  recent: "Ainda em tempo",
  now: "Agora",
  week: "Esta semana",
  next: "Próximos 30 dias",
  digital: "Digital",
  physical: "Mídia física",
  theatrical: "Cinema",
};

function bump(map: Map<string, RadarFilter>, id: string, group: RadarFilter["group"]) {
  const key = `${group}:${id}`;
  const current = map.get(key);
  if (current) {
    current.count += 1;
  } else {
    map.set(key, { id, group, label: FILTER_LABELS[id] ?? id, count: 1 });
  }
}

export function buildRadarFilters(payload: Pick<RadarPayload, "sections">): RadarFilter[] {
  const map = new Map<string, RadarFilter>();
  const seenEvents = new Set<string>();
  for (const section of Object.values(payload.sections)) {
    for (const event of section.items) {
      const key = `${section.id}:${event.id}`;
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
      bump(map, event.contentType, "contentType");
      bump(map, event.eventType, "eventType");
      bump(map, section.id, "timeWindow");
      if (event.releaseType) bump(map, event.releaseType, "releaseType");
    }
  }
  return [...map.values()].filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
}

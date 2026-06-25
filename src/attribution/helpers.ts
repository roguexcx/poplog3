import { API_SOURCES } from "./api-sources";
import type { ApiSourceDefinition, ApiSourceId, AttributionContext } from "./types";

const SOURCE_ALIASES: Record<string, ApiSourceId> = {
  tmdb: "tmdb",
  watchmode: "watchmode",
  trakt: "trakt",
  motn: "movieofthenight",
  movieofthenight: "movieofthenight",
  "movie-of-the-night": "movieofthenight",
  movie_of_the_night: "movieofthenight",
  bancodeseries: "bancodeseries",
  banco_de_series: "bancodeseries",
  "banco-de-series": "bancodeseries",
  balloonerismm: "balloonerismm",
  justwatch: "balloonerismm",
  justwatch_graphql_unofficial: "balloonerismm",
};

const CONTEXT_LABELS: Record<AttributionContext, string> = {
  metadata: "Dados",
  images: "Imagens",
  availability: "Disponibilidade",
  ratings: "Avaliações",
  community: "Comunidade",
  catalogRadar: "Radar de catálogo",
  calendar: "Agenda",
};

export function normalizeSourceId(source: string | null | undefined) {
  if (!source) return null;
  const key = source.trim().toLowerCase();
  return SOURCE_ALIASES[key] ?? null;
}

export function getSource(source: string | null | undefined) {
  const id = normalizeSourceId(source);
  return id ? API_SOURCES[id] : null;
}

export function getSourceLabel(source: string | null | undefined) {
  return getSource(source)?.shortName ?? getSource(source)?.name ?? source ?? "";
}

export function resolveSources(
  sourcesUsed: Array<string | null | undefined>,
): ApiSourceDefinition[] {
  const seen = new Set<ApiSourceId>();
  const sources: ApiSourceDefinition[] = [];

  for (const source of sourcesUsed) {
    const id = normalizeSourceId(source);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    sources.push(API_SOURCES[id]);
  }

  return sources;
}

export function joinSourceNames(sources: ApiSourceDefinition[]) {
  const names = sources.map((source) => source.shortName ?? source.name);

  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} e ${names[1]}`;

  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

export function formatContextualAttribution(
  context: AttributionContext,
  sourcesUsed: Array<string | null | undefined>,
) {
  const sources = resolveSources(sourcesUsed);
  if (sources.length === 0) return null;

  return `${CONTEXT_LABELS[context]} via ${joinSourceNames(sources)}`;
}

export function getProviderSourceIds<T extends { source?: string | null }>(
  providers: T[] | null | undefined,
) {
  if (!providers?.length) return [];
  return providers.map((provider) => provider.source ?? "tmdb");
}

export function getRatingSourceIds(input: {
  imdbRating?: number | null;
  imdbVotes?: number | null;
  rottenTomatoesScore?: number | null;
  metacriticScore?: number | null;
  tmdbRating?: number | null;
}) {
  const sources: ApiSourceId[] = [];

  if (typeof input.tmdbRating === "number") {
    sources.push("tmdb");
  }

  return sources;
}

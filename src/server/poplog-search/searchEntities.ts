/**
 * Resolver de busca unificada do POPLOG.
 *
 * Aceita nome (pt/original), IMDb id de título (tt) ou pessoa (nm),
 * `tmdb:ID`, `trakt:ID` e `slug:...`. Serve com cache persistente local
 * (PoplogSearchCache, TTL 7d) com revalidação no acesso e fallback stale.
 *
 * Fontes:
 *   - Texto: catalogSearch (Balloonerismm primário, Trakt fallback) +
 *     catalogSearchPeople (Balloonerismm).
 *   - ID de título (tt/tmdb/trakt/slug): catalogGetMovie/catalogGetShow (Trakt).
 *   - ID de pessoa (nm): perfil via Balloonerismm /person/{id}.
 *
 * TODO(trakt-people-search): o Trakt tem /search/person, mas o projeto ainda
 * não expõe um adapter para isso. Pessoas vêm do Balloonerismm (igual à página
 * de pessoa). Encaixar Trakt aqui quando o adapter existir.
 */

import type { Prisma } from "@prisma/client";
import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";
import type { BalloonerismPersonDetails } from "@/server/api-clients/balloonerismm/types";
import {
  catalogSearch,
  catalogSearchPeople,
  catalogGetMovie,
  catalogGetShow,
  type PersonSearchResult,
} from "@/server/source-engine/engine";
import type { CatalogTitle } from "@/server/source-engine/types/catalog.types";
import {
  readSearchCache,
  upsertSearchCache,
  type CacheState,
} from "@/server/poplog-cache/entity-cache";
import {
  titleResultToEntity,
  catalogTitleToEntity,
  personResultToEntity,
  personByIdToEntity,
  dedupeEntities,
  groupEntities,
} from "./mergeResults";
import type {
  PoplogSearchEntity,
  PoplogSearchEntitiesResult,
  PoplogSearchQueryType,
} from "./types";

const DEFAULT_LANGUAGE = "pt-BR";
const DEFAULT_REGION = "BR";
const DEFAULT_LIMIT = 24;

type QueryRoute =
  | { kind: "imdb-title"; imdbId: string }
  | { kind: "imdb-person"; imdbId: string }
  | { kind: "tmdb"; tmdbId: number }
  | { kind: "trakt"; traktId: number }
  | { kind: "slug"; slug: string }
  | { kind: "text"; text: string };

/**
 * Classifica a query para roteamento de fonte. Mais rica que detectSearchQueryType
 * (distingue tt-título de nm-pessoa); a partição de cache continua via
 * detectSearchQueryType dentro de read/upsertSearchCache.
 */
function classifyQuery(query: string): QueryRoute {
  const q = query.trim();
  const lower = q.toLowerCase();

  if (/^tt\d+$/.test(lower)) return { kind: "imdb-title", imdbId: lower };
  if (/^nm\d+$/.test(lower)) return { kind: "imdb-person", imdbId: lower };

  if (lower.startsWith("tmdb:")) {
    const id = Number(lower.slice(5).trim());
    if (Number.isFinite(id) && id > 0) return { kind: "tmdb", tmdbId: id };
  }
  if (lower.startsWith("trakt:")) {
    const id = Number(lower.slice(6).trim());
    if (Number.isFinite(id) && id > 0) return { kind: "trakt", traktId: id };
  }
  if (lower.startsWith("slug:")) {
    const slug = lower.slice(5).trim();
    if (slug) return { kind: "slug", slug };
  }

  return { kind: "text", text: q };
}

type FetchOutcome = {
  entities: PoplogSearchEntity[];
  sources: { trakt: boolean; balloonerismm: boolean };
};

// ─── Busca por id de título (tenta movie e show; Trakt) ───────────────────────

async function lookupTitleById(
  params: { imdbId?: string; tmdbId?: number; traktId?: number; traktSlug?: string }
): Promise<CatalogTitle[]> {
  const [movie, show] = await Promise.all([
    catalogGetMovie(params).catch(() => null),
    catalogGetShow(params).catch(() => null),
  ]);
  return [movie, show].filter((t): t is CatalogTitle => t !== null);
}

// ─── Busca textual (títulos + pessoas em paralelo) ────────────────────────────

async function fetchTextSearch(query: string): Promise<FetchOutcome> {
  const [titles, people] = await Promise.all([
    catalogSearch({ query, page: 1 }).catch(() => []),
    catalogSearchPeople(query).catch(() => [] as PersonSearchResult[]),
  ]);

  const titleEntities = titles.map((t, i) => {
    const entity = titleResultToEntity(t);
    entity.score = titles.length - i; // preserva ordem da fonte no dedup/sort
    return entity;
  });
  const peopleEntities = people
    .map((p, i) => {
      const entity = personResultToEntity(p);
      if (entity) entity.score = people.length - i;
      return entity;
    })
    .filter((e): e is PoplogSearchEntity => e !== null);

  const entities = [...titleEntities, ...peopleEntities];
  return { entities, sources: aggregateSources(entities) };
}

async function fetchPersonById(imdbId: string): Promise<FetchOutcome> {
  const profile = await balloonerismGet<BalloonerismPersonDetails>(`/person/${imdbId}`, {
    ttlSeconds: 86_400,
  }).catch(() => null);

  const entity = personByIdToEntity({
    imdbId,
    name: profile?.name ?? null,
    profileImage: profile?.profile_path ?? null,
    knownForDepartment: profile?.known_for_department ?? null,
    fromBalloon: Boolean(profile),
  });
  const entities = entity ? [entity] : [];
  return { entities, sources: aggregateSources(entities) };
}

async function fetchTitleById(
  params: { imdbId?: string; tmdbId?: number; traktId?: number; traktSlug?: string }
): Promise<FetchOutcome> {
  const titles = await lookupTitleById(params);
  const entities = titles.map(catalogTitleToEntity);
  return { entities, sources: aggregateSources(entities) };
}

function aggregateSources(
  entities: PoplogSearchEntity[]
): { trakt: boolean; balloonerismm: boolean } {
  return {
    trakt: entities.some((e) => e.sources?.trakt),
    balloonerismm: entities.some((e) => e.sources?.balloonerismm),
  };
}

async function fetchFromSources(route: QueryRoute): Promise<FetchOutcome> {
  switch (route.kind) {
    case "imdb-title":
      return fetchTitleById({ imdbId: route.imdbId });
    case "tmdb":
      return fetchTitleById({ tmdbId: route.tmdbId });
    case "trakt":
      return fetchTitleById({ traktId: route.traktId });
    case "slug":
      return fetchTitleById({ traktSlug: route.slug });
    case "imdb-person":
      return fetchPersonById(route.imdbId);
    case "text":
      return fetchTextSearch(route.text);
  }
}

// ─── Montagem do resultado ────────────────────────────────────────────────────

function buildResult(input: {
  query: string;
  queryNormalized: string;
  queryType: PoplogSearchQueryType;
  entities: PoplogSearchEntity[];
  limit: number;
  cache: CacheState;
  usedStaleFallback?: boolean;
  sources: { trakt?: boolean; balloonerismm?: boolean };
}): PoplogSearchEntitiesResult {
  const deduped = dedupeEntities(input.entities)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, input.limit);
  return {
    query: input.query,
    queryNormalized: input.queryNormalized,
    queryType: input.queryType,
    results: deduped,
    grouped: groupEntities(deduped),
    meta: {
      cache: input.cache,
      ...(input.usedStaleFallback ? { usedStaleFallback: true } : {}),
      sources: input.sources,
    },
  };
}

function entitiesFromCache(value: unknown): PoplogSearchEntity[] {
  return Array.isArray(value) ? (value as PoplogSearchEntity[]) : [];
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function searchEntities(input: {
  query: string;
  language?: string;
  region?: string;
  forceRefresh?: boolean;
  limit?: number;
}): Promise<PoplogSearchEntitiesResult> {
  const language = input.language ?? DEFAULT_LANGUAGE;
  const region = input.region ?? DEFAULT_REGION;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const query = input.query.trim();

  const cached = await readSearchCache({ query, language, region });
  const queryType = cached.queryType as PoplogSearchQueryType;

  // 1. Cache fresh → retorna direto
  if (!input.forceRefresh && cached.state === "fresh" && cached.record) {
    const sourceCoverage = (cached.record.sourceCoverage ?? {}) as {
      trakt?: boolean;
      balloonerismm?: boolean;
    };
    return buildResult({
      query,
      queryNormalized: cached.queryNormalized,
      queryType,
      entities: entitiesFromCache(cached.record.results),
      limit,
      cache: "fresh",
      sources: sourceCoverage,
    });
  }

  // 2. Revalidação no acesso
  const route = classifyQuery(query);
  let outcome: FetchOutcome | null = null;
  try {
    outcome = await fetchFromSources(route);
  } catch (err) {
    console.warn(
      `[poplog-search] external fetch failed for "${query}":`,
      err instanceof Error ? err.message : err
    );
  }

  if (outcome && outcome.entities.length > 0) {
    const deduped = dedupeEntities(outcome.entities);
    try {
      await upsertSearchCache({
        query,
        results: deduped as unknown as Prisma.InputJsonValue,
        resultCount: deduped.length,
        sourceCoverage: outcome.sources as unknown as Prisma.InputJsonValue,
        language,
        region,
      });
    } catch (err) {
      console.warn(
        `[poplog-search] cache persist failed for "${query}":`,
        err instanceof Error ? err.message : err
      );
    }
    return buildResult({
      query,
      queryNormalized: cached.queryNormalized,
      queryType,
      entities: deduped,
      limit,
      cache: cached.state,
      sources: outcome.sources,
    });
  }

  // 3. Falha externa → fallback para cache antigo (stale/expired)
  if (cached.record) {
    const sourceCoverage = (cached.record.sourceCoverage ?? {}) as {
      trakt?: boolean;
      balloonerismm?: boolean;
    };
    return buildResult({
      query,
      queryNormalized: cached.queryNormalized,
      queryType,
      entities: entitiesFromCache(cached.record.results),
      limit,
      cache: cached.state,
      usedStaleFallback: true,
      sources: sourceCoverage,
    });
  }

  // 4. Sem fontes e sem cache → resultado vazio
  return buildResult({
    query,
    queryNormalized: cached.queryNormalized,
    queryType,
    entities: [],
    limit,
    cache: cached.state,
    sources: outcome?.sources ?? {},
  });
}

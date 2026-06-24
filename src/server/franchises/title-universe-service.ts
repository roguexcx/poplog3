import type { TitleCollection, TitleUniverse } from "@/features/title/types";
import {
  entityIdFromUri,
  fetchWikidataSparql,
  type WikidataSparqlCell,
} from "@/server/api-clients/wikidata/client";
import {
  findWikidataItemByImdbId,
  getDirectSeriesByP179,
  normalizeAndFilterMovieItems,
  sortFranchiseItems,
  type DirectSeries,
  type WikidataTitleItem,
} from "@/server/franchises/direct-franchise-service";

type UniverseInput = {
  imdbId?: string | null;
  directFranchise?: TitleCollection | null;
};

type UniverseContainer = {
  qid: string;
  name: string;
  relation: "P8345" | "P361" | "P527" | "P1434";
};

type UniverseCacheEntry = {
  expiresAt: number;
  value: TitleUniverse | null;
};

type SparqlBinding = Record<string, WikidataSparqlCell | undefined>;

const POSITIVE_CACHE_TTL_MS = 14 * 24 * 60 * 60_000;
const ABSENT_CACHE_TTL_MS = 12 * 60 * 60_000;
const POSITIVE_REVALIDATE_SECONDS = 14 * 24 * 60 * 60;
const ABSENT_REVALIDATE_SECONDS = 12 * 60 * 60;

const universeCache = new Map<string, UniverseCacheEntry>();

function isImdbId(value: string | null | undefined): value is string {
  return Boolean(value && /^tt\d+$/i.test(value.trim()));
}

function isQid(value: string | null | undefined): value is string {
  return Boolean(value && /^Q\d+$/.test(value));
}

function qidToNumericId(qid: string): number {
  return Number(qid.slice(1));
}

function cellValue(row: SparqlBinding, key: string): string | null {
  const value = row[key]?.value?.trim();
  return value ? value : null;
}

function parsePositiveInt(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function qidsFromConcat(value: string | null): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split("|")
        .map((uri) => entityIdFromUri(uri.trim()))
        .filter((qid): qid is string => isQid(qid)),
    ),
  );
}

function readCache(key: string): TitleUniverse | null | undefined {
  const cached = universeCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    universeCache.delete(key);
    return undefined;
  }
  return cached.value;
}

function writeCache(
  key: string,
  value: TitleUniverse | null,
  ttlMs = value ? POSITIVE_CACHE_TTL_MS : ABSENT_CACHE_TTL_MS,
) {
  universeCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function wikidataItemFromRow(row: SparqlBinding): WikidataTitleItem | null {
  const qid = entityIdFromUri(cellValue(row, "item") ?? undefined);
  if (!qid) return null;

  return {
    qid,
    label: cellValue(row, "itemLabel"),
    description: cellValue(row, "itemDescription"),
    imdbId: cellValue(row, "imdbId"),
    tmdbMovieId: parsePositiveInt(cellValue(row, "tmdbMovieId")),
    tmdbTvId: parsePositiveInt(cellValue(row, "tmdbTvId")),
    releaseDate: normalizeDate(cellValue(row, "releaseDate")),
    imageUrl: cellValue(row, "image"),
    predecessorQids: qidsFromConcat(cellValue(row, "predecessors")),
    successorQids: qidsFromConcat(cellValue(row, "successors")),
  };
}

async function getUniverseContainers(input: {
  baseQid: string;
  directSeries?: DirectSeries | null;
}): Promise<UniverseContainer[]> {
  const seedQids = [input.baseQid, input.directSeries?.qid]
    .filter((qid): qid is string => isQid(qid));
  if (seedQids.length === 0) return [];

  const seedValues = seedQids.map((qid) => `wd:${qid}`).join(" ");
  const excludedValues = seedQids.map((qid) => `wd:${qid}`).join(", ");
  const query = `SELECT DISTINCT ?container ?containerLabel ?relation WHERE {
  VALUES ?seed { ${seedValues} }
  {
    ?seed wdt:P8345 ?container.
    BIND("P8345" AS ?relation)
  } UNION {
    ?seed wdt:P361 ?container.
    BIND("P361" AS ?relation)
  } UNION {
    ?container wdt:P527 ?seed.
    BIND("P527" AS ?relation)
  } UNION {
    ?seed wdt:P1434 ?container.
    BIND("P1434" AS ?relation)
  }
  FILTER(?container NOT IN (${excludedValues}))
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt-br,pt,en". }
} LIMIT 12`;

  const data = await fetchWikidataSparql<SparqlBinding>(query, {
    revalidateSeconds: ABSENT_REVALIDATE_SECONDS,
    timeoutMs: 6_000,
  });

  const containers = (data.results?.bindings ?? [])
    .map((row): UniverseContainer | null => {
      const qid = entityIdFromUri(cellValue(row, "container") ?? undefined);
      if (!qid) return null;
      return {
        qid,
        name: cellValue(row, "containerLabel") ?? "Universo compartilhado",
        relation: (cellValue(row, "relation") as UniverseContainer["relation"] | null) ?? "P361",
      };
    })
    .filter((container): container is UniverseContainer => Boolean(container));

  const mediaFranchiseContainers = containers.filter((container) => container.relation === "P8345");
  if (mediaFranchiseContainers.length > 0) return mediaFranchiseContainers;

  const structuralContainers = containers.filter((container) => container.relation === "P361" || container.relation === "P527");
  if (structuralContainers.length > 0) return structuralContainers;

  return containers.filter((container) => container.relation === "P1434");
}

function universeMembersQuery(input: {
  containerQids: string[];
  baseQid: string;
  directSeriesQid?: string | null;
  requireDirectSeries?: boolean;
}): string {
  const containerValues = input.containerQids.map((qid) => `wd:${qid}`).join(" ");
  const directSeriesFilter = input.directSeriesQid
    ? `FILTER(!BOUND(?directSeries) || ?directSeries != wd:${input.directSeriesQid})`
    : "";
  const directSeriesPresenceFilter = input.requireDirectSeries
    ? "FILTER(BOUND(?directSeries))"
    : "";

  return `SELECT ?item ?itemLabel ?itemDescription ?imdbId ?tmdbMovieId ?tmdbTvId
       (MIN(?releaseDateRaw) AS ?releaseDate)
       (SAMPLE(?imageRaw) AS ?image)
       (GROUP_CONCAT(DISTINCT STR(?predecessorRaw); separator="|") AS ?predecessors)
       (GROUP_CONCAT(DISTINCT STR(?successorRaw); separator="|") AS ?successors)
WHERE {
  VALUES ?container { ${containerValues} }
  {
    ?item wdt:P361 ?container.
  } UNION {
    ?item wdt:P1434 ?container.
  } UNION {
    ?item wdt:P8345 ?container.
  } UNION {
    ?container wdt:P527 ?item.
  }
  FILTER(?item != wd:${input.baseQid})
  ?item wdt:P31/wdt:P279* ?validClass.
  VALUES ?validClass { wd:Q11424 wd:Q506240 wd:Q5398426 }
  OPTIONAL { ?item wdt:P179 ?directSeries. }
  OPTIONAL { ?item wdt:P345 ?imdbId. }
  OPTIONAL { ?item wdt:P4947 ?tmdbMovieId. }
  OPTIONAL { ?item wdt:P4983 ?tmdbTvId. }
  OPTIONAL { ?item wdt:P577 ?releaseDateRaw. }
  OPTIONAL { ?item wdt:P18 ?imageRaw. }
  OPTIONAL { ?item wdt:P155 ?predecessorRaw. }
  OPTIONAL { ?item wdt:P156 ?successorRaw. }
  FILTER(BOUND(?imdbId) || BOUND(?tmdbMovieId) || BOUND(?tmdbTvId))
  ${directSeriesFilter}
  ${directSeriesPresenceFilter}
  FILTER NOT EXISTS { ?item wdt:P31/wdt:P279* wd:Q571. }
  FILTER NOT EXISTS { ?item wdt:P31/wdt:P279* wd:Q7889. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt-br,pt,en". }
}
GROUP BY ?item ?itemLabel ?itemDescription ?imdbId ?tmdbMovieId ?tmdbTvId
LIMIT 80`;
}

async function getUniverseMembers(input: {
  containers: UniverseContainer[];
  baseQid: string;
  directSeriesQid?: string | null;
}): Promise<WikidataTitleItem[]> {
  const containerQids = input.containers
    .map((container) => container.qid)
    .filter((qid): qid is string => isQid(qid));
  if (containerQids.length === 0) return [];

  const data = await fetchWikidataSparql<SparqlBinding>(universeMembersQuery({
    containerQids,
    baseQid: input.baseQid,
    directSeriesQid: input.directSeriesQid ?? null,
    requireDirectSeries: input.containers.every((container) => container.relation === "P8345"),
  }), {
    revalidateSeconds: POSITIVE_REVALIDATE_SECONDS,
    timeoutMs: 7_000,
  });

  return (data.results?.bindings ?? [])
    .map(wikidataItemFromRow)
    .filter((item): item is WikidataTitleItem => Boolean(item));
}

export async function resolveTitleUniverseForTitle(
  input: UniverseInput,
): Promise<TitleUniverse | null> {
  if (!isImdbId(input.imdbId)) return null;

  const cacheKey = `universe:imdb:${input.imdbId.trim().toLowerCase()}`;
  const cached = readCache(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const baseItem = await findWikidataItemByImdbId(input.imdbId);
    if (!baseItem) {
      writeCache(cacheKey, null);
      return null;
    }

    const directSeries = baseItem.directSeries ?? await getDirectSeriesByP179(baseItem.qid);
    const containers = await getUniverseContainers({
      baseQid: baseItem.qid,
      directSeries,
    });
    if (containers.length === 0) {
      writeCache(cacheKey, null);
      return null;
    }

    const members = await getUniverseMembers({
      containers,
      baseQid: baseItem.qid,
      directSeriesQid: directSeries?.qid ?? null,
    });
    const normalized = await normalizeAndFilterMovieItems(members);
    const directIds = new Set(input.directFranchise?.parts?.map((part) => part.id) ?? []);
    const parts = sortFranchiseItems(normalized, members).parts
      .filter((part) => !directIds.has(part.id));

    if (parts.length === 0) {
      writeCache(cacheKey, null);
      return null;
    }

    const primaryContainer = containers[0];
    const universe: TitleUniverse = {
      id: qidToNumericId(primaryContainer.qid),
      name: primaryContainer.name,
      source: "wikidata",
      engine: "same-universe",
      universeQid: primaryContainer.qid,
      parts,
    };

    writeCache(cacheKey, universe);
    return universe;
  } catch (error) {
    console.warn("[title-universe] Wikidata resolution failed", {
      imdbId: input.imdbId,
      message: error instanceof Error ? error.message : String(error),
    });
    writeCache(cacheKey, null, ABSENT_CACHE_TTL_MS);
    return null;
  }
}

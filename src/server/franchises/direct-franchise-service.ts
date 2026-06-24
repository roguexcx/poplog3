import type {
  TitleCollection,
  TitleCollectionPart,
  TitleMediaType,
} from "@/features/title/types";
import { syntheticTmdbFromImdbId } from "@/lib/ids/synthetic-tmdb-id";
import {
  entityIdFromUri,
  fetchWikidataSparql,
  type WikidataSparqlCell,
} from "@/server/api-clients/wikidata/client";
import { db } from "@/server/db/client";

type DirectFranchiseInput = {
  mediaType: TitleMediaType;
  imdbId?: string | null;
  tmdbId?: number | null;
  poplogId?: string | number | null;
  title?: string | null;
};

export type DirectSeries = {
  qid: string;
  name: string;
};

export type WikidataTitleItem = {
  qid: string;
  label: string | null;
  description: string | null;
  imdbId: string | null;
  tmdbMovieId: number | null;
  tmdbTvId: number | null;
  releaseDate: string | null;
  imageUrl: string | null;
  predecessorQids: string[];
  successorQids: string[];
};

type WikidataBaseItem = {
  qid: string;
  label: string | null;
  directSeries: DirectSeries | null;
};

type LocalTitleRow = {
  tmdbId: number;
  mediaType: TitleMediaType;
  imdbId: string | null;
  title: string | null;
  originalTitle: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: Date | null;
  firstAirDate: Date | null;
  year: number | null;
};

type LocalTitleMaps = {
  byImdbId: Map<string, LocalTitleRow>;
  byTmdbKey: Map<string, LocalTitleRow>;
};

type FranchiseCacheEntry = {
  expiresAt: number;
  value: TitleCollection | null;
};

type SparqlBinding = Record<string, WikidataSparqlCell | undefined>;

const POSITIVE_CACHE_TTL_MS = 30 * 24 * 60 * 60_000;
const ABSENT_CACHE_TTL_MS = 6 * 60 * 60_000;
const WIKIDATA_POSITIVE_REVALIDATE_SECONDS = 30 * 24 * 60 * 60;
const WIKIDATA_ABSENT_REVALIDATE_SECONDS = 6 * 60 * 60;

const directFranchiseCache = new Map<string, FranchiseCacheEntry>();

function isImdbId(value: string | null | undefined): value is string {
  return Boolean(value && /^tt\d+$/i.test(value.trim()));
}

function isQid(value: string | null | undefined): value is string {
  return Boolean(value && /^Q\d+$/.test(value));
}

function qidToNumericId(qid: string): number {
  return Number(qid.slice(1));
}

function parsePositiveInt(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function cellValue(row: SparqlBinding, key: string): string | null {
  const value = row[key]?.value?.trim();
  return value ? value : null;
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

function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dateFromLocal(row: LocalTitleRow | null, mediaType: TitleMediaType): string | null {
  const value = mediaType === "tv" ? row?.firstAirDate : row?.releaseDate;
  return value ? value.toISOString().slice(0, 10) : null;
}

function yearFromDate(value: string | null): number | null {
  if (!value) return null;
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

function cacheKey(input: DirectFranchiseInput): string | null {
  if (isImdbId(input.imdbId)) return `imdb:${input.imdbId.trim().toLowerCase()}`;
  if (input.poplogId != null) return `poplog:${String(input.poplogId)}`;
  if (input.tmdbId != null) return `tmdb:${input.mediaType}:${input.tmdbId}`;
  return null;
}

function readCache(key: string | null): TitleCollection | null | undefined {
  if (!key) return undefined;
  const cached = directFranchiseCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    directFranchiseCache.delete(key);
    return undefined;
  }
  return cached.value;
}

export function cacheDirectFranchise(
  key: string,
  value: TitleCollection | null,
  ttlMs = value ? POSITIVE_CACHE_TTL_MS : ABSENT_CACHE_TTL_MS,
): void {
  directFranchiseCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function titleItemFromRow(row: SparqlBinding): WikidataTitleItem | null {
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

export async function findWikidataItemByImdbId(
  imdbId: string,
): Promise<WikidataBaseItem | null> {
  const trimmed = imdbId.trim();
  if (!isImdbId(trimmed)) return null;

  const query = `SELECT ?item ?itemLabel ?series ?seriesLabel WHERE {
  ?item wdt:P345 "${trimmed}".
  OPTIONAL { ?item wdt:P179 ?series. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt-br,pt,en". }
} LIMIT 10`;

  const data = await fetchWikidataSparql<SparqlBinding>(query, {
    revalidateSeconds: WIKIDATA_ABSENT_REVALIDATE_SECONDS,
    timeoutMs: 6_000,
  });

  const rows = data.results?.bindings ?? [];
  const first = rows
    .map((row): WikidataBaseItem | null => {
      const qid = entityIdFromUri(cellValue(row, "item") ?? undefined);
      if (!qid) return null;
      const seriesQid = entityIdFromUri(cellValue(row, "series") ?? undefined);
      return {
        qid,
        label: cellValue(row, "itemLabel"),
        directSeries: seriesQid
          ? {
              qid: seriesQid,
              name: cellValue(row, "seriesLabel") ?? "Franquia",
            }
          : null,
      };
    })
    .find((item): item is WikidataBaseItem => Boolean(item));

  return first ?? null;
}

export async function getDirectSeriesByP179(
  itemQid: string,
): Promise<DirectSeries | null> {
  if (!isQid(itemQid)) return null;

  const query = `SELECT ?series ?seriesLabel WHERE {
  wd:${itemQid} wdt:P179 ?series.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt-br,pt,en". }
} LIMIT 5`;

  const data = await fetchWikidataSparql<SparqlBinding>(query, {
    revalidateSeconds: WIKIDATA_ABSENT_REVALIDATE_SECONDS,
    timeoutMs: 6_000,
  });

  const row = data.results?.bindings?.[0];
  if (!row) return null;

  const qid = entityIdFromUri(cellValue(row, "series") ?? undefined);
  if (!qid) return null;

  return {
    qid,
    name: cellValue(row, "seriesLabel") ?? "Franquia",
  };
}

function seriesMembersQuery(seriesQid: string): string {
  return `SELECT ?item ?itemLabel ?itemDescription ?imdbId ?tmdbMovieId ?tmdbTvId
       (MIN(?releaseDateRaw) AS ?releaseDate)
       (SAMPLE(?imageRaw) AS ?image)
       (GROUP_CONCAT(DISTINCT STR(?predecessorRaw); separator="|") AS ?predecessors)
       (GROUP_CONCAT(DISTINCT STR(?successorRaw); separator="|") AS ?successors)
WHERE {
  ?item wdt:P179 wd:${seriesQid}.
  ?item wdt:P31/wdt:P279* ?validClass.
  VALUES ?validClass { wd:Q11424 wd:Q506240 wd:Q5398426 }
  OPTIONAL { ?item wdt:P345 ?imdbId. }
  OPTIONAL { ?item wdt:P4947 ?tmdbMovieId. }
  OPTIONAL { ?item wdt:P4983 ?tmdbTvId. }
  OPTIONAL { ?item wdt:P577 ?releaseDateRaw. }
  OPTIONAL { ?item wdt:P18 ?imageRaw. }
  OPTIONAL { ?item wdt:P155 ?predecessorRaw. }
  OPTIONAL { ?item wdt:P156 ?successorRaw. }
  FILTER(BOUND(?imdbId) || BOUND(?tmdbMovieId) || BOUND(?tmdbTvId))
  FILTER NOT EXISTS { ?item wdt:P31/wdt:P279* wd:Q571. }
  FILTER NOT EXISTS { ?item wdt:P31/wdt:P279* wd:Q7889. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt-br,pt,en". }
}
GROUP BY ?item ?itemLabel ?itemDescription ?imdbId ?tmdbMovieId ?tmdbTvId
LIMIT 80`;
}

export async function getSeriesMembersByP179(
  seriesQid: string,
): Promise<WikidataTitleItem[]> {
  if (!isQid(seriesQid)) return [];

  const data = await fetchWikidataSparql<SparqlBinding>(seriesMembersQuery(seriesQid), {
    revalidateSeconds: WIKIDATA_POSITIVE_REVALIDATE_SECONDS,
    timeoutMs: 7_000,
  });

  return (data.results?.bindings ?? [])
    .map(titleItemFromRow)
    .filter((item): item is WikidataTitleItem => Boolean(item));
}

function fallbackSequenceQuery(seedQid: string): string {
  return `SELECT ?item ?itemLabel ?itemDescription ?imdbId ?tmdbMovieId ?tmdbTvId
       (MIN(?releaseDateRaw) AS ?releaseDate)
       (SAMPLE(?imageRaw) AS ?image)
       (GROUP_CONCAT(DISTINCT STR(?predecessorRaw); separator="|") AS ?predecessors)
       (GROUP_CONCAT(DISTINCT STR(?successorRaw); separator="|") AS ?successors)
WHERE {
  VALUES ?seed { wd:${seedQid} }
  {
    ?item (wdt:P156|^wdt:P155)* ?seed.
  } UNION {
    ?seed (wdt:P156|^wdt:P155)* ?item.
  }
  ?item wdt:P31/wdt:P279* ?validClass.
  VALUES ?validClass { wd:Q11424 wd:Q506240 wd:Q5398426 }
  OPTIONAL { ?item wdt:P345 ?imdbId. }
  OPTIONAL { ?item wdt:P4947 ?tmdbMovieId. }
  OPTIONAL { ?item wdt:P4983 ?tmdbTvId. }
  OPTIONAL { ?item wdt:P577 ?releaseDateRaw. }
  OPTIONAL { ?item wdt:P18 ?imageRaw. }
  OPTIONAL { ?item wdt:P155 ?predecessorRaw. }
  OPTIONAL { ?item wdt:P156 ?successorRaw. }
  FILTER(BOUND(?imdbId) || BOUND(?tmdbMovieId) || BOUND(?tmdbTvId))
  FILTER NOT EXISTS { ?item wdt:P31/wdt:P279* wd:Q571. }
  FILTER NOT EXISTS { ?item wdt:P31/wdt:P279* wd:Q7889. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt-br,pt,en". }
}
GROUP BY ?item ?itemLabel ?itemDescription ?imdbId ?tmdbMovieId ?tmdbTvId
LIMIT 25`;
}

async function getFallbackSequenceByPredecessorSuccessor(
  seedQid: string,
): Promise<WikidataTitleItem[]> {
  if (!isQid(seedQid)) return [];

  const data = await fetchWikidataSparql<SparqlBinding>(fallbackSequenceQuery(seedQid), {
    revalidateSeconds: WIKIDATA_ABSENT_REVALIDATE_SECONDS,
    timeoutMs: 7_000,
  });

  return (data.results?.bindings ?? [])
    .map(titleItemFromRow)
    .filter((item): item is WikidataTitleItem => Boolean(item));
}

async function getLocalTitleMaps(items: WikidataTitleItem[]): Promise<LocalTitleMaps> {
  const imdbIds = Array.from(
    new Set(items.map((item) => item.imdbId).filter((id): id is string => isImdbId(id))),
  );
  const tmdbIds = Array.from(
    new Set(
      items
        .flatMap((item) => [item.tmdbMovieId, item.tmdbTvId])
        .filter((id): id is number => id != null && Number.isInteger(id) && id > 0),
    ),
  );

  const [byTmdb, byImdb, externalRows] = await Promise.all([
    tmdbIds.length
      ? db.poplog3Title.findMany({
          where: { tmdbId: { in: tmdbIds }, mediaType: { in: ["movie", "tv"] } },
          select: {
            tmdbId: true,
            mediaType: true,
            imdbId: true,
            title: true,
            originalTitle: true,
            posterPath: true,
            backdropPath: true,
            releaseDate: true,
            firstAirDate: true,
            year: true,
          },
        }).catch(() => [])
      : Promise.resolve([]),
    imdbIds.length
      ? db.poplog3Title.findMany({
          where: { imdbId: { in: imdbIds }, mediaType: { in: ["movie", "tv"] } },
          select: {
            tmdbId: true,
            mediaType: true,
            imdbId: true,
            title: true,
            originalTitle: true,
            posterPath: true,
            backdropPath: true,
            releaseDate: true,
            firstAirDate: true,
            year: true,
          },
        }).catch(() => [])
      : Promise.resolve([]),
    imdbIds.length
      ? db.titleExternalId.findMany({
          where: { imdbId: { in: imdbIds } },
          select: { imdbId: true, tmdbId: true, mediaType: true },
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const externalKeys = new Set(
    externalRows
      .filter((row) => row.tmdbId > 0)
      .map((row) => `${row.mediaType}:${row.tmdbId}`),
  );
  const existingKeys = new Set(
    [...byTmdb, ...byImdb].map((row) => `${row.mediaType}:${row.tmdbId}`),
  );
  const missingExternalIds = Array.from(externalKeys)
    .filter((key) => !existingKeys.has(key))
    .map((key) => {
      const [, rawTmdbId] = key.split(":");
      return Number(rawTmdbId);
    })
    .filter((id) => Number.isInteger(id) && id > 0);

  const byExternalTmdb = missingExternalIds.length
    ? await db.poplog3Title.findMany({
        where: { tmdbId: { in: missingExternalIds }, mediaType: { in: ["movie", "tv"] } },
        select: {
          tmdbId: true,
          mediaType: true,
          imdbId: true,
          title: true,
          originalTitle: true,
          posterPath: true,
          backdropPath: true,
          releaseDate: true,
          firstAirDate: true,
          year: true,
        },
      }).catch(() => [])
    : [];

  const rows = [...byTmdb, ...byImdb, ...byExternalTmdb] as LocalTitleRow[];
  const byTmdbKey = new Map<string, LocalTitleRow>();
  const byImdbId = new Map<string, LocalTitleRow>();

  for (const row of rows) {
    byTmdbKey.set(`${row.mediaType}:${row.tmdbId}`, row);
    if (row.imdbId) byImdbId.set(row.imdbId, row);
  }

  for (const external of externalRows) {
    if (!external.imdbId) continue;
    const row = byTmdbKey.get(`${external.mediaType}:${external.tmdbId}`);
    if (row && !byImdbId.has(external.imdbId)) byImdbId.set(external.imdbId, row);
  }

  return { byImdbId, byTmdbKey };
}

function localForItem(item: WikidataTitleItem, maps: LocalTitleMaps): LocalTitleRow | null {
  if (item.imdbId) {
    const byImdb = maps.byImdbId.get(item.imdbId);
    if (byImdb) return byImdb;
  }
  if (item.tmdbMovieId) {
    const byMovieTmdb = maps.byTmdbKey.get(`movie:${item.tmdbMovieId}`);
    if (byMovieTmdb) return byMovieTmdb;
  }
  if (item.tmdbTvId) {
    const byTvTmdb = maps.byTmdbKey.get(`tv:${item.tmdbTvId}`);
    if (byTvTmdb) return byTvTmdb;
  }
  return null;
}

function mediaTypeForItem(item: WikidataTitleItem, local: LocalTitleRow | null): TitleMediaType {
  if (local?.mediaType) return local.mediaType;
  if (item.tmdbTvId && !item.tmdbMovieId) return "tv";
  return "movie";
}

export async function normalizeAndFilterMovieItems(
  items: WikidataTitleItem[],
): Promise<TitleCollectionPart[]> {
  const maps = await getLocalTitleMaps(items);
  const seen = new Set<string>();
  const parts: TitleCollectionPart[] = [];

  for (const item of items) {
    const local = localForItem(item, maps);
    const mediaType = mediaTypeForItem(item, local);
    const tmdbId =
      local?.tmdbId ??
      (mediaType === "tv" ? item.tmdbTvId : item.tmdbMovieId) ??
      item.tmdbMovieId ??
      item.tmdbTvId ??
      null;
    const syntheticId = item.imdbId ? syntheticTmdbFromImdbId(item.imdbId) : null;
    const id = tmdbId ?? syntheticId;
    if (!id || !Number.isInteger(id)) continue;

    const dedupeKey = item.imdbId ?? `${mediaType}:${id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const releaseDate = dateFromLocal(local, mediaType) ?? item.releaseDate;
    const title =
      local?.title?.trim() ||
      local?.originalTitle?.trim() ||
      item.label?.trim() ||
      "Titulo sem nome";

    parts.push({
      id,
      mediaType,
      tmdbId,
      imdbId: item.imdbId,
      wikidataQid: item.qid,
      title,
      releaseDate,
      year: local?.year ?? yearFromDate(releaseDate),
      posterPath: local?.posterPath ?? item.imageUrl,
    });
  }

  return parts;
}

function releaseTimestamp(part: TitleCollectionPart): number {
  if (!part.releaseDate) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(part.releaseDate);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function buildChronologicalOrder(
  parts: TitleCollectionPart[],
  sourceItems: WikidataTitleItem[],
): number[] | null {
  const idByQid = new Map<string, number>();
  for (const part of parts) {
    if (part.wikidataQid) idByQid.set(part.wikidataQid, part.id);
  }
  if (idByQid.size !== parts.length || parts.length < 2) return null;

  const qids = new Set(idByQid.keys());
  const successorByQid = new Map<string, string>();
  const predecessorCountByQid = new Map<string, number>();

  function addEdge(from: string, to: string): boolean {
    const existing = successorByQid.get(from);
    if (existing && existing !== to) return false;
    successorByQid.set(from, to);
    return true;
  }

  for (const item of sourceItems) {
    if (!qids.has(item.qid)) continue;
    const successorCandidates = item.successorQids.filter((qid) => qids.has(qid));
    const predecessorCandidates = item.predecessorQids.filter((qid) => qids.has(qid));

    if (successorCandidates.length > 1 || predecessorCandidates.length > 1) return null;

    const successor = successorCandidates[0];
    if (successor) {
      if (!addEdge(item.qid, successor)) return null;
    }

    const predecessor = predecessorCandidates[0];
    if (predecessor) {
      if (!addEdge(predecessor, item.qid)) return null;
    }
  }

  for (const successor of successorByQid.values()) {
    predecessorCountByQid.set(successor, (predecessorCountByQid.get(successor) ?? 0) + 1);
  }

  for (const count of predecessorCountByQid.values()) {
    if (count > 1) return null;
  }

  const starts = Array.from(qids).filter((qid) => !predecessorCountByQid.has(qid));
  if (starts.length !== 1 || successorByQid.size !== parts.length - 1) return null;

  const orderedQids: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = starts[0];

  while (current) {
    if (visited.has(current)) return null;
    visited.add(current);
    orderedQids.push(current);
    current = successorByQid.get(current);
  }

  if (orderedQids.length !== parts.length) return null;
  return orderedQids
    .map((qid) => idByQid.get(qid))
    .filter((id): id is number => typeof id === "number");
}

export function sortFranchiseItems(
  parts: TitleCollectionPart[],
  sourceItems: WikidataTitleItem[],
): {
  parts: TitleCollectionPart[];
  releaseOrder: number[];
  chronologicalOrder: number[] | null;
} {
  const releaseSorted = [...parts].sort((a, b) => {
    const byDate = releaseTimestamp(a) - releaseTimestamp(b);
    if (byDate !== 0) return byDate;
    return a.title.localeCompare(b.title, "pt-BR");
  });
  const releaseOrder = releaseSorted.map((part) => part.id);
  const chronologicalOrder = buildChronologicalOrder(releaseSorted, sourceItems);
  const chronologicalIndex = new Map(
    (chronologicalOrder ?? []).map((id, index) => [id, index + 1]),
  );

  return {
    parts: releaseSorted.map((part, index) => ({
      ...part,
      releaseOrder: index + 1,
      chronologicalOrder: chronologicalIndex.get(part.id) ?? null,
    })),
    releaseOrder,
    chronologicalOrder,
  };
}

function buildCollection(input: {
  series: DirectSeries;
  items: WikidataTitleItem[];
}): Promise<TitleCollection | null> {
  return normalizeAndFilterMovieItems(input.items).then((parts) => {
    if (parts.length < 2) return null;

    const sorted = sortFranchiseItems(parts, input.items);
    const posterPath = sorted.parts.find((part) => part.posterPath)?.posterPath ?? null;

    return {
      id: qidToNumericId(input.series.qid),
      name: input.series.name,
      source: "wikidata",
      engine: "direct-franchise",
      franchiseQid: input.series.qid,
      posterPath,
      parts: sorted.parts,
      releaseOrder: sorted.releaseOrder,
      ...(sorted.chronologicalOrder ? { chronologicalOrder: sorted.chronologicalOrder } : {}),
      orderType: "release",
    };
  });
}

export async function resolveDirectFranchiseForTitle(
  input: DirectFranchiseInput,
): Promise<TitleCollection | null> {
  if (!isImdbId(input.imdbId)) return null;

  const primaryCacheKey = cacheKey(input);
  const cached = readCache(primaryCacheKey);
  if (cached !== undefined) return cached;

  try {
    const baseItem = await findWikidataItemByImdbId(input.imdbId);
    if (!baseItem) {
      if (primaryCacheKey) cacheDirectFranchise(primaryCacheKey, null);
      return null;
    }

    const directSeries = baseItem.directSeries ?? await getDirectSeriesByP179(baseItem.qid);

    if (directSeries) {
      const franchiseCacheKey = `franchise:${directSeries.qid}`;
      const cachedFranchise = readCache(franchiseCacheKey);
      if (cachedFranchise !== undefined) {
        if (primaryCacheKey) cacheDirectFranchise(primaryCacheKey, cachedFranchise);
        return cachedFranchise;
      }

      const members = await getSeriesMembersByP179(directSeries.qid);
      const collection = await buildCollection({ series: directSeries, items: members });
      cacheDirectFranchise(franchiseCacheKey, collection);
      if (primaryCacheKey) cacheDirectFranchise(primaryCacheKey, collection);
      return collection;
    }

    const fallbackItems = await getFallbackSequenceByPredecessorSuccessor(baseItem.qid);
    const fallbackCollection = await buildCollection({
      series: {
        qid: baseItem.qid,
        name: "Sequencia direta",
      },
      items: fallbackItems,
    });

    if (primaryCacheKey) cacheDirectFranchise(primaryCacheKey, fallbackCollection);
    return fallbackCollection;
  } catch (error) {
    console.warn("[direct-franchise] Wikidata resolution failed", {
      imdbId: input.imdbId,
      message: error instanceof Error ? error.message : String(error),
    });
    if (primaryCacheKey) cacheDirectFranchise(primaryCacheKey, null, ABSENT_CACHE_TTL_MS);
    return null;
  }
}

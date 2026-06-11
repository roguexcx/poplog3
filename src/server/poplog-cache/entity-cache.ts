import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  PoplogPeopleCache,
  PoplogPersonCreditsCache,
  PoplogSearchCache,
  SearchQueryType,
} from "@prisma/client";
import { db } from "@/server/db/client";

const DEFAULT_LANGUAGE = "pt-BR";
const DEFAULT_REGION = "BR";
const DEFAULT_PERSON_SOURCE = "trakt";
const DEFAULT_PERSON_SOURCE_VERSION = "people-v1";

export type CacheState = "missing" | "fresh" | "stale" | "expired";

export const POPLOG_CACHE_TTLS = {
  personProfileDays: 90,
  personCreditsDays: 30,
  personImagesDays: 120,
  searchDays: 7,
} as const;

export function getCacheState(input: {
  now?: Date;
  staleAt?: Date | null;
  expiresAt?: Date | null;
}): CacheState {
  const now = input.now ?? new Date();
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) return "expired";
  if (input.staleAt && input.staleAt.getTime() <= now.getTime()) return "stale";
  return "fresh";
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function buildCacheDates(input: {
  now?: Date;
  ttlDays: number;
  staleAfterDays?: number;
}): {
  staleAt: Date;
  expiresAt: Date;
  lastFetchedAt: Date;
} {
  const now = input.now ?? new Date();
  const staleAfterDays = input.staleAfterDays ?? input.ttlDays / 2;
  return {
    staleAt: addDays(now, staleAfterDays),
    expiresAt: addDays(now, input.ttlDays),
    lastFetchedAt: now,
  };
}

function toTraktBigInt(value: bigint | number | null | undefined): bigint | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "number" ? BigInt(value) : value;
}

function toJsonInput(
  value: Prisma.InputJsonValue | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value;
}

/** True quando o erro Prisma é violação de unique constraint (P2002). */
function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/**
 * Executa um upsert blindado contra race condition: dois acessos concorrentes
 * podem tentar criar a mesma linha e um deles bate em P2002. Nesse caso,
 * relê a linha já gravada pelo concorrente e a retorna. Para qualquer outro
 * erro (ou se a releitura não encontrar nada), relança.
 */
async function upsertWithRaceFallback<T>(
  upsert: () => Promise<T>,
  reread: () => Promise<T | null>
): Promise<T> {
  try {
    return await upsert();
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      const existing = await reread();
      if (existing) return existing;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Pessoa — PoplogPeopleCache (perfil 90d, imagens 120d)
// ---------------------------------------------------------------------------

export async function readPersonCache(personId: string): Promise<{
  state: CacheState;
  record: PoplogPeopleCache | null;
}> {
  const record = await db.poplogPeopleCache.findUnique({ where: { personId } });
  if (!record) return { state: "missing", record: null };
  return {
    state: getCacheState({ staleAt: record.staleAt, expiresAt: record.expiresAt }),
    record,
  };
}

export async function upsertPersonCache(input: {
  personId: string;
  source?: string;
  sourceVersion?: string;
  traktId?: bigint | number | null;
  traktSlug?: string | null;
  tmdbId?: number | null;
  imdbId?: string | null;
  name: string;
  originalName?: string | null;
  profileImage?: string | null;
  imageCandidatesJson?: Prisma.InputJsonValue | null;
  payload: Prisma.InputJsonValue;
  traktPayload?: Prisma.InputJsonValue | null;
  balloonPayload?: Prisma.InputJsonValue | null;
  language?: string;
  region?: string;
}): Promise<PoplogPeopleCache> {
  const now = new Date();
  const { staleAt, expiresAt, lastFetchedAt } = buildCacheDates({
    now,
    ttlDays: POPLOG_CACHE_TTLS.personProfileDays,
  });
  const imagesExpiresAt = addDays(now, POPLOG_CACHE_TTLS.personImagesDays);

  const data = {
    source: input.source ?? DEFAULT_PERSON_SOURCE,
    sourceVersion: input.sourceVersion ?? DEFAULT_PERSON_SOURCE_VERSION,
    traktId: toTraktBigInt(input.traktId),
    traktSlug: input.traktSlug,
    tmdbId: input.tmdbId,
    imdbId: input.imdbId,
    name: input.name,
    originalName: input.originalName,
    profileImage: input.profileImage,
    imageCandidatesJson: toJsonInput(input.imageCandidatesJson),
    imagesExpiresAt,
    payload: input.payload,
    traktPayload: toJsonInput(input.traktPayload),
    balloonPayload: toJsonInput(input.balloonPayload),
    language: input.language ?? DEFAULT_LANGUAGE,
    region: input.region ?? DEFAULT_REGION,
    staleAt,
    expiresAt,
    lastFetchedAt,
  };

  return upsertWithRaceFallback(
    () =>
      db.poplogPeopleCache.upsert({
        where: { personId: input.personId },
        create: { personId: input.personId, ...data },
        update: data,
      }),
    () => db.poplogPeopleCache.findUnique({ where: { personId: input.personId } })
  );
}

// ---------------------------------------------------------------------------
// Créditos — PoplogPersonCreditsCache (30d)
// ---------------------------------------------------------------------------

export async function readPersonCreditsCache(input: {
  personId: string;
  language?: string;
  region?: string;
}): Promise<{
  state: CacheState;
  record: PoplogPersonCreditsCache | null;
}> {
  const record = await db.poplogPersonCreditsCache.findUnique({
    where: {
      personId_language_region: {
        personId: input.personId,
        language: input.language ?? DEFAULT_LANGUAGE,
        region: input.region ?? DEFAULT_REGION,
      },
    },
  });
  if (!record) return { state: "missing", record: null };
  return {
    state: getCacheState({ staleAt: record.staleAt, expiresAt: record.expiresAt }),
    record,
  };
}

export async function upsertPersonCreditsCache(input: {
  personId: string;
  acting?: Prisma.InputJsonValue | null;
  directing?: Prisma.InputJsonValue | null;
  writing?: Prisma.InputJsonValue | null;
  producing?: Prisma.InputJsonValue | null;
  otherCrew?: Prisma.InputJsonValue | null;
  payload: Prisma.InputJsonValue;
  sourceCoverage?: Prisma.InputJsonValue | null;
  language?: string;
  region?: string;
}): Promise<PoplogPersonCreditsCache> {
  const language = input.language ?? DEFAULT_LANGUAGE;
  const region = input.region ?? DEFAULT_REGION;
  const { staleAt, expiresAt, lastFetchedAt } = buildCacheDates({
    ttlDays: POPLOG_CACHE_TTLS.personCreditsDays,
  });

  const data = {
    acting: toJsonInput(input.acting),
    directing: toJsonInput(input.directing),
    writing: toJsonInput(input.writing),
    producing: toJsonInput(input.producing),
    otherCrew: toJsonInput(input.otherCrew),
    payload: input.payload,
    sourceCoverage: toJsonInput(input.sourceCoverage),
    staleAt,
    expiresAt,
    lastFetchedAt,
  };

  return upsertWithRaceFallback(
    () =>
      db.poplogPersonCreditsCache.upsert({
        where: {
          personId_language_region: { personId: input.personId, language, region },
        },
        create: { personId: input.personId, language, region, ...data },
        update: data,
      }),
    () =>
      db.poplogPersonCreditsCache.findUnique({
        where: {
          personId_language_region: { personId: input.personId, language, region },
        },
      })
  );
}

// ---------------------------------------------------------------------------
// Busca — PoplogSearchCache (7d)
// ---------------------------------------------------------------------------

export function normalizeSearchQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function detectSearchQueryType(query: string): SearchQueryType {
  const normalized = query.trim().toLowerCase();
  // IMDb ids: tt... (título) e nm... (pessoa) caem no mesmo bucket "imdb".
  if (/^(tt|nm)\d+$/.test(normalized)) return "imdb";
  if (normalized.startsWith("tmdb:")) return "tmdb";
  if (normalized.startsWith("trakt:")) return "trakt";
  // slug só com prefixo explícito "slug:" — termos hifenizados digitados pelo
  // usuário (ex.: "spider-man") são busca TEXTUAL, não slug.
  if (normalized.startsWith("slug:")) return "slug";
  return "text";
}

export function buildSearchQueryHash(input: {
  queryNormalized: string;
  queryType: SearchQueryType;
  language?: string;
  region?: string;
}): string {
  const language = input.language ?? DEFAULT_LANGUAGE;
  const region = input.region ?? DEFAULT_REGION;
  return createHash("sha256")
    .update(`${input.queryType}:${language}:${region}:${input.queryNormalized}`)
    .digest("hex");
}

export async function readSearchCache(input: {
  query: string;
  language?: string;
  region?: string;
}): Promise<{
  state: CacheState;
  record: PoplogSearchCache | null;
  queryNormalized: string;
  queryType: SearchQueryType;
  queryHash: string;
}> {
  const language = input.language ?? DEFAULT_LANGUAGE;
  const region = input.region ?? DEFAULT_REGION;
  const queryNormalized = normalizeSearchQuery(input.query);
  const queryType = detectSearchQueryType(input.query);
  const queryHash = buildSearchQueryHash({ queryNormalized, queryType, language, region });

  const record = await db.poplogSearchCache.findUnique({
    where: {
      queryHash_queryType_language_region: { queryHash, queryType, language, region },
    },
  });

  if (!record) {
    return { state: "missing", record: null, queryNormalized, queryType, queryHash };
  }
  return {
    state: getCacheState({ staleAt: record.staleAt, expiresAt: record.expiresAt }),
    record,
    queryNormalized,
    queryType,
    queryHash,
  };
}

export async function upsertSearchCache(input: {
  query: string;
  results: Prisma.InputJsonValue;
  resultCount?: number;
  sourceCoverage?: Prisma.InputJsonValue | null;
  language?: string;
  region?: string;
}): Promise<PoplogSearchCache> {
  const language = input.language ?? DEFAULT_LANGUAGE;
  const region = input.region ?? DEFAULT_REGION;
  const queryNormalized = normalizeSearchQuery(input.query);
  const queryType = detectSearchQueryType(input.query);
  const queryHash = buildSearchQueryHash({ queryNormalized, queryType, language, region });
  const { staleAt, expiresAt, lastFetchedAt } = buildCacheDates({
    ttlDays: POPLOG_CACHE_TTLS.searchDays,
  });
  const resultCount =
    input.resultCount ?? (Array.isArray(input.results) ? input.results.length : 0);

  const data = {
    query: input.query.trim(),
    queryNormalized,
    results: input.results,
    resultCount,
    sourceCoverage: toJsonInput(input.sourceCoverage),
    staleAt,
    expiresAt,
    lastFetchedAt,
  };

  return upsertWithRaceFallback(
    () =>
      db.poplogSearchCache.upsert({
        where: {
          queryHash_queryType_language_region: { queryHash, queryType, language, region },
        },
        create: { queryHash, queryType, language, region, ...data },
        update: data,
      }),
    () =>
      db.poplogSearchCache.findUnique({
        where: {
          queryHash_queryType_language_region: { queryHash, queryType, language, region },
        },
      })
  );
}

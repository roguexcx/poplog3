import { db } from "@/server/db/client";
import { upsertExternalIdsCache } from "@/server/repositories/external-ids-cache.repository";
import type { PoplogTitleExternalIds } from "./poplog-title-identity";

type MediaType = "movie" | "tv";

type TitleRow = {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string | null;
  originalTitle: string | null;
  year: number | null;
  tmdbPayload: unknown;
};

type ExternalIdsRow = {
  tmdbId: number;
  mediaType: MediaType;
  imdbId: string | null;
  tvdbId: string | null;
  traktId: string | null;
};

export type PoplogTitleAliasSources = {
  localTitle?: boolean;
  titleExternalIds?: boolean;
  cache?: boolean;
  balloonerismm?: boolean;
};

export type PoplogTitleAliasResolution = {
  aliasLookupAttempted: boolean;
  aliasLookupSource: string[];
  aliasLookupFound: boolean;
  externalIdsBefore: PoplogTitleExternalIds;
  externalIdsAfter: PoplogTitleExternalIds;
  aliasSources: PoplogTitleAliasSources;
  aliasPersisted: boolean;
  aliasPersistReason: string | null;
};

export type PoplogTitleAliasResult = {
  poplogId?: string;
  mediaType: MediaType;
  title?: string;
  year?: number;
  externalIds: PoplogTitleExternalIds;
  aliasSources: PoplogTitleAliasSources;
  debug: PoplogTitleAliasResolution;
};

type ResolveAliasesInput = {
  mediaType: MediaType;
  poplogId?: string | number;
  externalIds?: PoplogTitleExternalIds;
  title?: string;
  year?: number;
};

function compactExternalIds(ids: PoplogTitleExternalIds): PoplogTitleExternalIds {
  return Object.fromEntries(
    Object.entries(ids).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  ) as PoplogTitleExternalIds;
}

function numberFromString(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function idsChanged(before: PoplogTitleExternalIds, after: PoplogTitleExternalIds): boolean {
  return (
    before.tmdbId !== after.tmdbId ||
    before.imdbId !== after.imdbId ||
    before.tvdbId !== after.tvdbId ||
    before.traktId !== after.traktId ||
    before.balloonerismmId !== after.balloonerismmId ||
    before.slug !== after.slug
  );
}

function extractPayloadExternalIds(payload: unknown): PoplogTitleExternalIds {
  if (!payload || typeof payload !== "object") return {};

  const root = payload as Record<string, unknown>;
  const externalIds = root.external_ids && typeof root.external_ids === "object"
    ? root.external_ids as Record<string, unknown>
    : {};

  const imdbRaw = root.imdb_id ?? externalIds.imdb_id;
  const tvdbRaw = externalIds.tvdb_id;
  const traktRaw = externalIds.trakt_id;

  return compactExternalIds({
    imdbId: typeof imdbRaw === "string" && /^tt\d+$/i.test(imdbRaw) ? imdbRaw : undefined,
    tvdbId: typeof tvdbRaw === "number" ? tvdbRaw : numberFromString(typeof tvdbRaw === "string" ? tvdbRaw : undefined),
    traktId: typeof traktRaw === "number" || typeof traktRaw === "string" ? traktRaw : undefined,
  });
}

function mergeExternalIds(...items: Array<PoplogTitleExternalIds | undefined>): PoplogTitleExternalIds {
  const merged: PoplogTitleExternalIds = {};
  for (const item of items) {
    if (!item) continue;
    if (item.tmdbId !== undefined) merged.tmdbId = item.tmdbId;
    if (item.imdbId) merged.imdbId = item.imdbId;
    if (item.tvdbId !== undefined) merged.tvdbId = item.tvdbId;
    if (item.traktId !== undefined) merged.traktId = item.traktId;
    if (item.balloonerismmId) merged.balloonerismmId = item.balloonerismmId;
    if (item.slug) merged.slug = item.slug;
  }

  if (!merged.balloonerismmId && merged.imdbId) {
    merged.balloonerismmId = merged.imdbId;
  }

  return compactExternalIds(merged);
}

async function findLocalTitle(input: ResolveAliasesInput): Promise<TitleRow | null> {
  if (input.poplogId) {
    const row = await db.poplog3Title.findFirst({
      where: { id: String(input.poplogId), mediaType: input.mediaType },
      select: {
        id: true,
        tmdbId: true,
        mediaType: true,
        title: true,
        originalTitle: true,
        year: true,
        tmdbPayload: true,
      },
    }).catch(() => null);
    if (row) return row as TitleRow;
  }

  const tmdbId = input.externalIds?.tmdbId;
  if (!tmdbId) return null;

  return db.poplog3Title.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType: input.mediaType } },
    select: {
      id: true,
      tmdbId: true,
      mediaType: true,
      title: true,
      originalTitle: true,
      year: true,
      tmdbPayload: true,
    },
  }).catch(() => null) as Promise<TitleRow | null>;
}

async function findExternalIds(
  mediaType: MediaType,
  ids: PoplogTitleExternalIds,
): Promise<ExternalIdsRow | null> {
  const or = [
    ids.tmdbId ? { tmdbId: ids.tmdbId, mediaType } : null,
    ids.imdbId ? { imdbId: ids.imdbId, mediaType } : null,
    ids.tvdbId ? { tvdbId: String(ids.tvdbId), mediaType } : null,
    ids.traktId ? { traktId: String(ids.traktId), mediaType } : null,
    ids.balloonerismmId ? { imdbId: ids.balloonerismmId, mediaType } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!or.length) return null;

  return db.titleExternalId.findFirst({
    where: { OR: or },
    select: {
      tmdbId: true,
      mediaType: true,
      imdbId: true,
      tvdbId: true,
      traktId: true,
    },
  }).catch(() => null) as Promise<ExternalIdsRow | null>;
}

async function persistMissingAliases(
  mediaType: MediaType,
  before: PoplogTitleExternalIds,
  after: PoplogTitleExternalIds,
): Promise<{ persisted: boolean; reason: string | null }> {
  if (!after.tmdbId) return { persisted: false, reason: "missing_tmdb_id" };

  const hasNewAlias = Boolean(
    (!before.imdbId && after.imdbId) ||
      (!before.tvdbId && after.tvdbId) ||
      (!before.traktId && after.traktId),
  );

  if (!hasNewAlias) {
    return { persisted: false, reason: "no_new_persistable_alias" };
  }

  const persisted = await upsertExternalIdsCache({
    tmdbId: after.tmdbId,
    mediaType,
    imdbId: after.imdbId ?? null,
    tvdbId: after.tvdbId !== undefined ? String(after.tvdbId) : null,
    traktId: after.traktId !== undefined ? String(after.traktId) : null,
  });

  return {
    persisted,
    reason: persisted ? "safe_idempotent_upsert" : "upsert_failed",
  };
}

export async function resolveAndMergeExternalIdsForPoplogTitle(
  input: ResolveAliasesInput,
): Promise<PoplogTitleAliasResult> {
  const before = compactExternalIds(input.externalIds ?? {});
  const aliasLookupSource: string[] = [];
  const aliasSources: PoplogTitleAliasSources = {};

  let localTitle = await findLocalTitle(input);
  if (localTitle) {
    aliasLookupSource.push(input.poplogId ? "localTitle:poplogId" : "localTitle:tmdbId");
    aliasSources.localTitle = true;
  }

  let externalRow = await findExternalIds(input.mediaType, before);
  if (externalRow) {
    aliasLookupSource.push("titleExternalIds:input");
    aliasSources.titleExternalIds = true;
    aliasSources.cache = true;
  }

  if (!localTitle && externalRow) {
    localTitle = await findLocalTitle({
      ...input,
      externalIds: { ...before, tmdbId: externalRow.tmdbId },
    });
    if (localTitle) {
      aliasLookupSource.push("localTitle:externalIds");
      aliasSources.localTitle = true;
    }
  }

  if (localTitle && (!externalRow || externalRow.tmdbId !== localTitle.tmdbId)) {
    externalRow = await findExternalIds(input.mediaType, { tmdbId: localTitle.tmdbId });
    if (externalRow) {
      aliasLookupSource.push("titleExternalIds:poplogTitle");
      aliasSources.titleExternalIds = true;
      aliasSources.cache = true;
    }
  }

  const externalIdsFromRow = externalRow
    ? compactExternalIds({
        tmdbId: externalRow.tmdbId,
        imdbId: externalRow.imdbId ?? undefined,
        tvdbId: numberFromString(externalRow.tvdbId) ?? undefined,
        traktId: externalRow.traktId ?? undefined,
        balloonerismmId: externalRow.imdbId ?? undefined,
      })
    : {};

  const payloadExternalIds = localTitle ? extractPayloadExternalIds(localTitle.tmdbPayload) : {};
  if (Object.keys(payloadExternalIds).length > 0) {
    aliasLookupSource.push("localTitle:tmdbPayload");
    aliasSources.localTitle = true;
  }

  const after = mergeExternalIds(
    localTitle ? { tmdbId: localTitle.tmdbId } : undefined,
    before,
    externalIdsFromRow,
    payloadExternalIds,
  );

  const persistResult = await persistMissingAliases(input.mediaType, before, after);

  return {
    poplogId: localTitle?.id ?? (input.poplogId ? String(input.poplogId) : undefined),
    mediaType: input.mediaType,
    title: localTitle?.title ?? localTitle?.originalTitle ?? input.title,
    year: localTitle?.year ?? input.year,
    externalIds: after,
    aliasSources,
    debug: {
      aliasLookupAttempted: true,
      aliasLookupSource,
      aliasLookupFound: idsChanged(before, after),
      externalIdsBefore: before,
      externalIdsAfter: after,
      aliasSources,
      aliasPersisted: persistResult.persisted,
      aliasPersistReason: persistResult.reason,
    },
  };
}

import { db } from "@/server/db/client";
import { normalizeSearchTerm } from "@/server/search/fuzzy-title-search";

type MediaType = "movie" | "tv";

export type PoplogTitleSourceHint =
  | "poplog"
  | "tmdb"
  | "imdb"
  | "balloonerismm"
  | "slug"
  | "auto";

export type PoplogTitleExternalIds = {
  tmdbId?: number;
  imdbId?: string;
  tvdbId?: number;
  traktId?: number | string;
  balloonerismmId?: string;
  slug?: string;
};

export type PoplogTitleIdentity = {
  poplogId?: string | number;
  mediaType: MediaType;
  title?: string;
  year?: number;
  externalIds: PoplogTitleExternalIds;
  resolvedFrom:
    | "poplog"
    | "slug"
    | "tmdb_id"
    | "imdb_id"
    | "balloonerismm_id"
    | "title_match"
    | "unknown";
  confidence: number;
};

type ResolveInput = {
  mediaType: MediaType;
  id: string;
  sourceHint?: PoplogTitleSourceHint;
  title?: string;
  year?: number;
};

type TitleRow = {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string | null;
  originalTitle: string | null;
  year: number | null;
};

function toPositiveNumber(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function slugParts(value: string): { title?: string; year?: number } {
  const trimmed = value.trim().toLowerCase();
  const yearMatch = trimmed.match(/(?:^|-)(\d{4})$/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  const title = trimmed
    .replace(/-\d{4}$/, "")
    .replace(/[-_]+/g, " ")
    .trim();

  return {
    title: title || undefined,
    year: Number.isFinite(year) ? year : undefined,
  };
}

function identityFromRow(
  row: TitleRow,
  resolvedFrom: PoplogTitleIdentity["resolvedFrom"],
  confidence: number,
  externalIds: PoplogTitleExternalIds = {},
): PoplogTitleIdentity {
  return {
    poplogId: row.id,
    mediaType: row.mediaType,
    title: row.title ?? row.originalTitle ?? undefined,
    year: row.year ?? undefined,
    externalIds: {
      tmdbId: row.tmdbId,
      ...externalIds,
    },
    resolvedFrom,
    confidence,
  };
}

async function findByPoplogId(mediaType: MediaType, id: string) {
  return db.poplog3Title.findFirst({
    where: { id, mediaType },
    select: {
      id: true,
      tmdbId: true,
      mediaType: true,
      title: true,
      originalTitle: true,
      year: true,
    },
  }).catch(() => null);
}

async function findByTmdbId(mediaType: MediaType, tmdbId: number) {
  return db.poplog3Title.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
    select: {
      id: true,
      tmdbId: true,
      mediaType: true,
      title: true,
      originalTitle: true,
      year: true,
    },
  }).catch(() => null);
}

async function findByExternalId(
  mediaType: MediaType,
  external: Partial<Pick<PoplogTitleExternalIds, "imdbId" | "tvdbId" | "traktId">>,
) {
  const or = [
    external.imdbId ? { imdbId: external.imdbId } : null,
    external.tvdbId ? { tvdbId: String(external.tvdbId) } : null,
    external.traktId ? { traktId: String(external.traktId) } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (!or.length) return null;

  const externalRow = await db.titleExternalId.findFirst({
    where: { mediaType, OR: or },
    select: {
      tmdbId: true,
      mediaType: true,
      imdbId: true,
      tvdbId: true,
      traktId: true,
    },
  }).catch(() => null);

  if (!externalRow) return null;
  const row = await findByTmdbId(mediaType, externalRow.tmdbId);
  if (!row) return null;

  return {
    row,
    externalIds: {
      imdbId: externalRow.imdbId ?? external.imdbId,
      tvdbId: externalRow.tvdbId ? Number(externalRow.tvdbId) : external.tvdbId,
      traktId: externalRow.traktId ?? external.traktId,
    },
  };
}

async function findByTitleYear(mediaType: MediaType, title?: string, year?: number) {
  if (!title || !year) return null;
  const normalized = normalizeSearchTerm(title);
  if (!normalized) return null;

  const rows = await db.poplog3Title.findMany({
    where: { mediaType, year },
    select: {
      id: true,
      tmdbId: true,
      mediaType: true,
      title: true,
      originalTitle: true,
      year: true,
    },
    take: 80,
  }).catch(() => []);

  return rows.find((row) => {
    const candidates = [row.title, row.originalTitle]
      .map((value) => normalizeSearchTerm(value ?? ""))
      .filter(Boolean);
    return candidates.includes(normalized);
  }) ?? null;
}

export async function resolvePoplogTitleIdentity({
  mediaType,
  id,
  sourceHint = "auto",
  title,
  year,
}: ResolveInput): Promise<PoplogTitleIdentity> {
  const cleanId = id.trim();
  const numericId = toPositiveNumber(cleanId);
  const isImdbId = /^tt\d+$/i.test(cleanId);

  if (mediaType !== "movie" && mediaType !== "tv") {
    return {
      mediaType,
      externalIds: {},
      resolvedFrom: "unknown",
      confidence: 0,
    };
  }

  if (sourceHint === "poplog" || (!numericId && !isImdbId && sourceHint === "auto")) {
    const row = await findByPoplogId(mediaType, cleanId);
    if (row) return identityFromRow(row as TitleRow, "poplog", 1);
  }

  if (isImdbId || sourceHint === "imdb" || sourceHint === "balloonerismm") {
    const imdbId = isImdbId ? cleanId : undefined;
    const match = await findByExternalId(mediaType, { imdbId });
    if (match) {
      return identityFromRow(match.row as TitleRow, "imdb_id", 0.96, {
        ...match.externalIds,
        imdbId,
        balloonerismmId: imdbId,
      });
    }

    return {
      mediaType,
      externalIds: {
        imdbId,
        balloonerismmId: imdbId,
      },
      resolvedFrom: sourceHint === "balloonerismm" ? "balloonerismm_id" : "imdb_id",
      confidence: imdbId ? 0.72 : 0.2,
    };
  }

  if (numericId) {
    if (sourceHint === "tmdb") {
      const row = await findByTmdbId(mediaType, numericId);
      if (row) {
        return identityFromRow(row as TitleRow, "tmdb_id", 0.9, { tmdbId: numericId });
      }
      return {
        mediaType,
        externalIds: { tmdbId: numericId },
        resolvedFrom: "tmdb_id",
        confidence: 0.45,
      };
    }

    const rowByPoplogId = await findByPoplogId(mediaType, cleanId);
    if (rowByPoplogId) return identityFromRow(rowByPoplogId as TitleRow, "poplog", 1);

    const rowByTmdbId = await findByTmdbId(mediaType, numericId);
    if (rowByTmdbId) {
      return identityFromRow(rowByTmdbId as TitleRow, "tmdb_id", 0.75, { tmdbId: numericId });
    }

    return {
      mediaType,
      externalIds: { tmdbId: numericId },
      resolvedFrom: "unknown",
      confidence: 0.25,
    };
  }

  const parsedSlug = sourceHint === "slug" || sourceHint === "auto"
    ? slugParts(cleanId)
    : {};
  const rowByTitle = await findByTitleYear(
    mediaType,
    title ?? parsedSlug.title,
    year ?? parsedSlug.year,
  );
  if (rowByTitle) {
    return identityFromRow(rowByTitle as TitleRow, sourceHint === "slug" ? "slug" : "title_match", 0.82, {
      slug: cleanId,
    });
  }

  return {
    mediaType,
    title: title ?? parsedSlug.title,
    year: year ?? parsedSlug.year,
    externalIds: { slug: cleanId },
    resolvedFrom: sourceHint === "slug" ? "slug" : "unknown",
    confidence: parsedSlug.title ? 0.35 : 0.1,
  };
}

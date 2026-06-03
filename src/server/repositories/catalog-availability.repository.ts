import { db } from "@/server/db/client";
import type {
  CatalogAvailabilitySource,
  MediaType,
  ProviderType,
  SourceConfidence,
} from "@prisma/client";

export type CatalogAvailabilityInput = {
  imdbId?: string | null;
  traktId?: bigint | number | null;
  tmdbId?: bigint | number | null;
  mediaType: MediaType;
  providerName: string;
  providerRegion: string;
  providerType: ProviderType;
  providerUrl?: string | null;
  providerLogoUrl?: string | null;
  source: CatalogAvailabilitySource;
  sourceConfidence: SourceConfidence;
  checkedAt?: Date | string;
  expiresAt: Date | string;
  evidencePayloadHash?: string | null;
  rawPayloadJson?: unknown;
};

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toBigIntValue(value: bigint | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  return typeof value === "bigint" ? value : BigInt(value);
}

export async function listCatalogAvailability(input: {
  imdbId?: string | null;
  traktId?: bigint | number | null;
  tmdbId?: bigint | number | null;
  mediaType?: MediaType;
  providerRegion?: string;
  includeExpired?: boolean;
}) {
  try {
    return await db.catalogAvailability.findMany({
      where: {
        imdbId: input.imdbId ?? undefined,
        traktId: input.traktId === undefined ? undefined : toBigIntValue(input.traktId),
        tmdbId: input.tmdbId === undefined ? undefined : toBigIntValue(input.tmdbId),
        mediaType: input.mediaType,
        providerRegion: input.providerRegion,
        expiresAt: input.includeExpired ? undefined : { gt: new Date() },
      },
      orderBy: [{ providerType: "asc" }, { providerName: "asc" }],
    });
  } catch (error) {
    console.warn("[catalog-availability.repository] list failed", messageFromError(error));
    return [];
  }
}

export async function replaceCatalogAvailability(input: {
  imdbId?: string | null;
  traktId?: bigint | number | null;
  tmdbId?: bigint | number | null;
  mediaType?: MediaType;
  source?: CatalogAvailabilitySource;
  providerRegion: string;
  rows: CatalogAvailabilityInput[];
}): Promise<boolean> {
  try {
    // When tmdbId + source are provided, use raw SQL to avoid Prisma enum where-filter
    // validation issues in deleteMany. Otherwise use the ORM path.
    if (input.tmdbId !== undefined && input.source !== undefined) {
      const tmdbIdBig = toBigIntValue(input.tmdbId)!;
      const mediaTypeStr = input.mediaType ?? "";
      const sourceStr = String(input.source);
      await db.$executeRaw`
        DELETE FROM catalog_availability
        WHERE tmdb_id = ${tmdbIdBig}
          AND media_type = ${mediaTypeStr}
          AND source = ${sourceStr}
          AND provider_region = ${input.providerRegion}
      `;
    } else {
      await db.catalogAvailability.deleteMany({
        where: {
          imdbId: input.imdbId ?? undefined,
          traktId: input.traktId === undefined ? undefined : toBigIntValue(input.traktId),
          providerRegion: input.providerRegion,
        },
      });
    }

    if (input.rows.length === 0) return true;

    await db.catalogAvailability.createMany({
      data: input.rows.map((row) => ({
        imdbId: row.imdbId ?? null,
        traktId: toBigIntValue(row.traktId),
        tmdbId: toBigIntValue(row.tmdbId),
        mediaType: row.mediaType,
        providerName: row.providerName,
        providerRegion: row.providerRegion,
        providerType: row.providerType,
        providerUrl: row.providerUrl ?? null,
        providerLogoUrl: row.providerLogoUrl ?? null,
        source: row.source,
        sourceConfidence: row.sourceConfidence,
        checkedAt: row.checkedAt ? toDate(row.checkedAt) : new Date(),
        expiresAt: toDate(row.expiresAt),
        evidencePayloadHash: row.evidencePayloadHash ?? null,
        rawPayloadJson: row.rawPayloadJson as object ?? undefined,
      })),
    });

    return true;
  } catch (error) {
    console.warn("[catalog-availability.repository] replace failed", messageFromError(error));
    return false;
  }
}

import {
  listCatalogAvailability,
  replaceCatalogAvailability,
  type CatalogAvailabilityInput,
} from "@/server/repositories";
import type { CatalogAvailabilitySource, MediaType, ProviderType, SourceConfidence } from "@prisma/client";

export type CatalogAvailabilityLocalInput = CatalogAvailabilityInput;

export type CatalogAvailabilityLocalRow = {
  imdb_id: string | null;
  trakt_id: string | null;
  tmdb_id: string | null;
  media_type: MediaType;
  provider_name: string;
  provider_region: string;
  provider_type: ProviderType;
  provider_url: string | null;
  provider_logo_url: string | null;
  source: CatalogAvailabilitySource;
  source_confidence: SourceConfidence;
  checked_at: string;
  expires_at: string;
  evidence_payload_hash: string | null;
  raw_payload_json: unknown;
};

export async function listAvailability(input: {
  imdbId?: string | null;
  traktId?: bigint | number | null;
  tmdbId?: bigint | number | null;
  mediaType?: MediaType;
  providerRegion?: string;
  includeExpired?: boolean;
}): Promise<CatalogAvailabilityLocalRow[]> {
  const rows = await listCatalogAvailability(input);
  return rows.map((row) => ({
    imdb_id: row.imdbId,
    trakt_id: row.traktId?.toString() ?? null,
    tmdb_id: row.tmdbId?.toString() ?? null,
    media_type: row.mediaType,
    provider_name: row.providerName,
    provider_region: row.providerRegion,
    provider_type: row.providerType,
    provider_url: row.providerUrl,
    provider_logo_url: row.providerLogoUrl,
    source: row.source,
    source_confidence: row.sourceConfidence,
    checked_at: row.checkedAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    evidence_payload_hash: row.evidencePayloadHash,
    raw_payload_json: row.rawPayloadJson,
  }));
}

export async function replaceAvailability(input: {
  imdbId?: string | null;
  traktId?: bigint | number | null;
  tmdbId?: bigint | number | null;
  mediaType?: MediaType;
  source?: CatalogAvailabilitySource;
  providerRegion: string;
  rows: CatalogAvailabilityLocalInput[];
}): Promise<boolean> {
  return replaceCatalogAvailability(input);
}

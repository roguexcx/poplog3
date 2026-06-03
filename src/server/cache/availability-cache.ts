import { formatError, logOnce } from "@/server/logging/log-control";

type MediaType = "movie" | "tv";

export type AvailabilityType =
  | "streaming"
  | "rent"
  | "buy"
  | "free"
  | "ads";

export type AvailabilitySource = "tmdb" | "watchmode" | "motn";

export type AvailabilityRow = {
  tmdb_id: number;
  media_type: MediaType;
  provider_id: string | null;
  provider_name: string;
  provider_logo_path: string | null;
  tmdb_provider_id: number | null;
  country: string;
  availability_type: AvailabilityType;
  source: AvailabilitySource;
  deep_link: string | null;
  quality: string | null;
  last_synced_at: string | null;
  provider_confidence?: string | null;
  last_checked_at?: string | null;
  expires_at?: string | null;
  fallback_checked_at?: string | null;
  fallback_result?: string | null;
  fallback_source?: string | null;
  next_fallback_allowed_at?: string | null;
};

export type UpsertAvailabilityInput = {
  tmdbId: number;
  mediaType: MediaType;
  country: string;
  source: AvailabilitySource;
  rows: Array<{
    providerName: string;
    providerLogoPath?: string | null;
    tmdbProviderId?: number | null;
    availabilityType: AvailabilityType;
    deepLink?: string | null;
    quality?: string | null;
    rawPayload?: unknown;
    providerConfidence?: string | null;
  }>;
  ttlDays?: number;
  fallback?: {
    checkedAt: string;
    result: string;
    source: string;
    nextAllowedAt: string;
  } | null;
};

// Mapping between Supabase availability_type and Prisma ProviderType
function availTypeToProviderType(t: AvailabilityType): string {
  if (t === "streaming") return "subscription";
  return t;
}

// Reverse: Prisma ProviderType -> availability_type
function providerTypeToAvailType(t: string): AvailabilityType {
  if (t === "subscription" || t === "local") return "streaming";
  if (t === "rent" || t === "buy" || t === "free" || t === "ads") {
    return t as AvailabilityType;
  }
  return "streaming";
}

// Prisma CatalogAvailabilitySource includes tmdb/watchmode/motn — same string values
function catalogSourceToAvailSource(s: string): AvailabilitySource {
  if (s === "watchmode" || s === "motn") return s as AvailabilitySource;
  return "tmdb";
}

// --- Public API ---

export async function getAvailability(
  mediaType: MediaType,
  tmdbId: number,
  country: string
): Promise<AvailabilityRow[]> {
  try {
    const local = await import("@/server/local-services/catalog-availability-local.service");
    const rows = await local.listAvailability({
       
      tmdbId: BigInt(tmdbId) as any,
       
      mediaType: mediaType as any,
      providerRegion: country,
    });
    return rows.map((row) => ({
      tmdb_id: row.tmdb_id ? Number(row.tmdb_id) : tmdbId,
      media_type: row.media_type as MediaType,
      provider_id: null,
      provider_name: row.provider_name,
      provider_logo_path: null,
      tmdb_provider_id: null,
      country,
      availability_type: providerTypeToAvailType(String(row.provider_type)),
      source: catalogSourceToAvailSource(String(row.source)),
      deep_link: null,
      quality: null,
      last_synced_at: row.checked_at ?? null,
      expires_at: row.expires_at ?? null,
    }));
  } catch (err) {
    logOnce(
      "availability:local:get-failed",
      "[availability] leitura local falhou — retornando vazio\n- local path error",
    );
    console.warn("[availability-cache/local/get]", err);
    return [];
  }
}

export function isAvailabilityFresh(
  rows: AvailabilityRow[],
  maxAgeDays = 7
): boolean {
  if (rows.length === 0) return false;
  const expirations = rows
    .map((r) => (r.expires_at ? new Date(r.expires_at).getTime() : null))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (expirations.length > 0) {
    return Math.min(...expirations) > Date.now();
  }

  const oldest = rows
    .map((r) => (r.last_synced_at ? new Date(r.last_synced_at).getTime() : 0))
    .reduce((a, b) => Math.min(a, b), Infinity);
  if (!Number.isFinite(oldest) || oldest === 0) return false;
  const ageDays = (Date.now() - oldest) / (24 * 60 * 60 * 1000);
  return ageDays <= maxAgeDays;
}

/**
 * Substitui completamente as linhas de disponibilidade pra um titulo+pais+source.
 * Estrategia "atomica simples": apaga e re-insere, tudo dentro do mesmo logical batch.
 * Justificativa: providers podem sumir do TMDB e nao queremos linhas orfas.
 */
export async function replaceAvailability(
  input: UpsertAvailabilityInput
): Promise<void> {
  const local = await import("@/server/local-services/catalog-availability-local.service");
  const { tmdbId, mediaType, country, source, rows, ttlDays } = input;

  const nowDate = new Date();
  const expiresAt = new Date(nowDate.getTime() + (ttlDays ?? 7) * 24 * 60 * 60 * 1000);

  const mappedRows = rows.map((r) => ({
     
    tmdbId: BigInt(tmdbId) as any,
     
    mediaType: mediaType as any,
    providerName: r.providerName,
    providerRegion: country,
     
    providerType: availTypeToProviderType(r.availabilityType) as any,
    providerUrl: null,
    providerLogoUrl: null,
     
    source: source as any,
     
    sourceConfidence: "medium" as any,
    checkedAt: nowDate,
    expiresAt,
    rawPayloadJson: r.rawPayload ?? null,
  }));

  const ok = await local.replaceAvailability({
     
    tmdbId: BigInt(tmdbId) as any,
     
    mediaType: mediaType as any,
     
    source: source as any,
    providerRegion: country,
    rows: mappedRows,
  });

  if (!ok) {
    throw new Error(
      `[availability-cache/local] replaceAvailability failed for ${mediaType}/${tmdbId}/${country}`,
    );
  }
}

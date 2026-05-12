import { createHash } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  StreamStatus,
  StreamingAccessType,
  StreamingAvailabilityResult,
  StreamingAvailabilityStatus,
  StreamingProvider,
  StreamingSourceApi,
} from "@/lib/streaming";

type MediaType = "movie" | "tv";

type CacheLookup = {
  tmdbId: number;
  mediaType: MediaType;
  country?: string;
};

type CacheWriteOptions = {
  releaseDate?: string | null;
};

export type CachedStreamingAvailability = {
  availability: StreamingAvailabilityResult;
  cacheValidUntil: string;
  isExpired: boolean;
};

type ProviderRow = {
  id: string;
  provider_name: string;
  provider_slug: string;
  logo_url: string | null;
  tmdb_provider_id: number | null;
  country: string;
};

type AvailabilityRow = {
  tmdb_id: number;
  imdb_id: string | null;
  media_type: MediaType;
  country: string;
  provider_id: string | null;
  access_type: StreamingAccessType;
  stream_status: StreamingAvailabilityStatus;
  legacy_stream_status: StreamStatus | null;
  source_api: StreamingSourceApi;
  source_confidence: number;
  available_abroad: boolean;
  inferred: boolean;
  deep_link: string | null;
  origin: "cinema" | "streaming" | null;
  estimated_platform: string | null;
  estimated_month: string | null;
  estimated_pvod_month: string | null;
  context_pool: string[] | null;
  source_apis: StreamingSourceApi[] | null;
  last_checked_at: string;
  cache_valid_until: string;
  streaming_providers: ProviderRow | null;
};

type AvailabilityStorageRow = {
  tmdb_id: number;
  imdb_id: string | null;
  media_type: MediaType;
  country: string;
  stream_status: StreamingAvailabilityStatus;
  legacy_stream_status: StreamStatus;
  source_confidence: number;
  available_abroad: boolean;
  inferred: boolean;
  origin: "cinema" | "streaming";
  estimated_platform: string | null;
  estimated_month: string | null;
  estimated_pvod_month: string | null;
  context_pool: string[];
  source_apis: StreamingSourceApi[];
  last_checked_at: string;
  cache_valid_until: string;
  raw_payload_hash: string;
  provider_id: string | null;
  access_type: StreamingAccessType;
  source_api: StreamingSourceApi;
  deep_link: string | null;
};

function addHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function addDays(days: number): string {
  return addHours(days * 24);
}

export function getStreamingAvailabilityTtl(
  status: StreamingAvailabilityStatus,
  releaseDate?: string | null,
): string {
  if (status === "upcoming") return addHours(12);
  if (status === "cinema_now" || status === "recently_released" || status === "digital_expected") {
    return addHours(24);
  }
  if (
    status === "available_subscription" ||
    status === "available_free" ||
    status === "available_rent" ||
    status === "available_buy"
  ) {
    return addDays(3);
  }

  if (releaseDate) {
    const daysSinceRelease = Math.floor((Date.now() - new Date(releaseDate).getTime()) / 86_400_000);
    if (daysSinceRelease >= 365) return addDays(14);
  }

  return addDays(7);
}

export function shouldRefreshStreamingAvailability(
  cached: CachedStreamingAvailability | null,
  forceRefresh = false,
): boolean {
  if (forceRefresh) return true;
  if (!cached) return true;
  return cached.isExpired;
}

function rawPayloadHash(payload: unknown): string {
  const serialized = JSON.stringify(payload ?? {});
  return createHash("sha256").update(serialized).digest("hex");
}

function emptyCategories() {
  return {
    flatrate: [] as StreamingProvider[],
    free: [] as StreamingProvider[],
    ads: [] as StreamingProvider[],
    rent: [] as StreamingProvider[],
    buy: [] as StreamingProvider[],
  };
}

function categoryForAccessType(accessType: StreamingAccessType): keyof ReturnType<typeof emptyCategories> | null {
  if (accessType === "subscription") return "flatrate";
  if (accessType === "free") return "free";
  if (accessType === "ads") return "ads";
  if (accessType === "rent") return "rent";
  if (accessType === "buy") return "buy";
  return null;
}

function mergeProviderAccess(provider: StreamingProvider, accessType: StreamingAccessType): StreamingProvider {
  return {
    ...provider,
    accessTypes: Array.from(new Set([...provider.accessTypes, accessType])),
  };
}

function rowToProvider(row: AvailabilityRow): StreamingProvider | null {
  const provider = row.streaming_providers;
  if (!provider) return null;

  return {
    providerId: provider.tmdb_provider_id ?? 0,
    providerName: provider.provider_name,
    providerSlug: provider.provider_slug,
    logoUrl: provider.logo_url ?? "",
    country: provider.country,
    accessTypes: [row.access_type],
    sourceApi: row.source_api,
    confidence: row.source_confidence,
    deepLink: row.deep_link ?? undefined,
    inferred: row.inferred,
    id: provider.tmdb_provider_id ?? 0,
    name: provider.provider_name,
    logo: provider.logo_url ?? "",
  };
}

export function hydrateAvailabilityFromCache(rows: AvailabilityRow[]): CachedStreamingAvailability | null {
  if (!rows.length) return null;

  const first = rows[0];
  const providerMap = new Map<string, StreamingProvider>();
  const categories = emptyCategories();
  const accessTypes = Array.from(new Set(rows.map((row) => row.access_type)));

  for (const row of rows) {
    const provider = rowToProvider(row);
    if (!provider) continue;

    const key = `${provider.country}:${provider.providerId || provider.providerSlug}`;
    const existing = providerMap.get(key);
    const merged = existing ? mergeProviderAccess(existing, row.access_type) : provider;
    providerMap.set(key, merged);

    const category = categoryForAccessType(row.access_type);
    if (category) {
      categories[category].push(provider);
    }
  }

  const cacheValidUntil = rows.reduce((earliest, row) => (
    new Date(row.cache_valid_until).getTime() < new Date(earliest).getTime()
      ? row.cache_valid_until
      : earliest
  ), first.cache_valid_until);

  const availability: StreamingAvailabilityResult = {
    tmdbId: first.tmdb_id,
    imdbId: first.imdb_id,
    mediaType: first.media_type,
    country: first.country,
    providers: Array.from(providerMap.values()),
    streamStatus: first.stream_status,
    legacyStreamStatus: first.legacy_stream_status ?? "unavailable",
    accessTypes,
    availableInCountry: Array.from(providerMap.values()).length > 0,
    availableAbroad: first.available_abroad,
    estimatedPlatform: first.estimated_platform,
    estimatedMonth: first.estimated_month,
    estimatedPvodMonth: first.estimated_pvod_month,
    sourceApis: first.source_apis ?? [first.source_api],
    confidenceScore: first.source_confidence,
    inferred: first.inferred,
    origin: first.origin ?? "streaming",
    contextPool: first.context_pool ?? [],
    lastCheckedAt: first.last_checked_at,
    debugNotes: ["cache_hit"],
    ...categories,
  };

  return {
    availability,
    cacheValidUntil,
    isExpired: new Date(cacheValidUntil).getTime() <= Date.now(),
  };
}

export async function getCachedStreamingAvailability({
  tmdbId,
  mediaType,
  country = "BR",
}: CacheLookup): Promise<CachedStreamingAvailability | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("title_streaming_availability")
      .select(`
        tmdb_id,
        imdb_id,
        media_type,
        country,
        provider_id,
        access_type,
        stream_status,
        legacy_stream_status,
        source_api,
        source_confidence,
        available_abroad,
        inferred,
        deep_link,
        origin,
        estimated_platform,
        estimated_month,
        estimated_pvod_month,
        context_pool,
        source_apis,
        last_checked_at,
        cache_valid_until,
        streaming_providers (
          id,
          provider_name,
          provider_slug,
          logo_url,
          tmdb_provider_id,
          country
        )
      `)
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType)
      .eq("country", country);

    if (error || !data) return null;
    return hydrateAvailabilityFromCache(data as unknown as AvailabilityRow[]);
  } catch {
    return null;
  }
}

async function upsertProvider(provider: StreamingProvider): Promise<string | null> {
  if (!provider.providerId && !provider.providerSlug) return null;

  const supabase = createSupabaseAdminClient();
  const payload = {
    provider_name: provider.providerName,
    provider_slug: provider.providerSlug,
    logo_url: provider.logoUrl || null,
    tmdb_provider_id: provider.providerId || null,
    country: provider.country,
    is_active: true,
  };

  const { data, error } = await supabase
    .from("streaming_providers")
    .upsert(payload, { onConflict: "country,tmdb_provider_id" })
    .select("id")
    .single();

  if (error || !data) return null;
  return (data as { id: string }).id;
}

export async function normalizeAvailabilityForStorage(
  availability: StreamingAvailabilityResult,
  options: CacheWriteOptions = {},
): Promise<AvailabilityStorageRow[]> {
  const providerIdMap = new Map<string, string>();
  for (const provider of availability.providers) {
    const id = await upsertProvider(provider);
    if (id) {
      providerIdMap.set(`${provider.country}:${provider.providerId || provider.providerSlug}`, id);
    }
  }

  const cacheValidUntil = getStreamingAvailabilityTtl(availability.streamStatus, options.releaseDate);
  const base = {
    tmdb_id: availability.tmdbId,
    imdb_id: availability.imdbId ?? null,
    media_type: availability.mediaType,
    country: availability.country,
    stream_status: availability.streamStatus,
    legacy_stream_status: availability.legacyStreamStatus,
    source_confidence: availability.confidenceScore,
    available_abroad: availability.availableAbroad,
    inferred: availability.inferred,
    origin: availability.origin,
    estimated_platform: availability.estimatedPlatform,
    estimated_month: availability.estimatedMonth,
    estimated_pvod_month: availability.estimatedPvodMonth,
    context_pool: availability.contextPool,
    source_apis: availability.sourceApis,
    last_checked_at: availability.lastCheckedAt,
    cache_valid_until: cacheValidUntil,
    raw_payload_hash: rawPayloadHash({
      providers: availability.providers,
      accessTypes: availability.accessTypes,
      status: availability.streamStatus,
      sourceApis: availability.sourceApis,
    }),
  };

  const rows = availability.providers.flatMap((provider) => {
    const providerId = providerIdMap.get(`${provider.country}:${provider.providerId || provider.providerSlug}`) ?? null;
    return provider.accessTypes.map((accessType) => ({
      ...base,
      provider_id: providerId,
      access_type: accessType,
      source_api: provider.sourceApi,
      deep_link: provider.deepLink ?? null,
    }));
  });

  if (rows.length > 0) return rows;

  return [{
    ...base,
    provider_id: null,
    access_type: availability.streamStatus === "cinema_now" ? "cinema" as const : "unknown" as const,
    source_api: availability.sourceApis[0] ?? "tmdb",
    deep_link: null,
  }];
}

export async function setCachedStreamingAvailability(
  availability: StreamingAvailabilityResult,
  options: CacheWriteOptions = {},
): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    const rows = await normalizeAvailabilityForStorage(availability, options);

    await supabase
      .from("title_streaming_availability")
      .delete()
      .eq("tmdb_id", availability.tmdbId)
      .eq("media_type", availability.mediaType)
      .eq("country", availability.country);

    await supabase.from("title_streaming_availability").insert(rows);
  } catch {
    // Cache persistence must never break the live resolver path.
  }
}

export async function invalidateStreamingAvailability({
  tmdbId,
  mediaType,
  country = "BR",
}: CacheLookup): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from("title_streaming_availability")
      .delete()
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType)
      .eq("country", country);
  } catch {
    // Best effort only.
  }
}

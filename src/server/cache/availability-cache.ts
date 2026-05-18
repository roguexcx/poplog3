import { supabaseAdmin } from "@/server/supabase/admin";

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
  }>;
};

export async function getAvailability(
  mediaType: MediaType,
  tmdbId: number,
  country: string
): Promise<AvailabilityRow[]> {
  const { data, error } = await supabaseAdmin
    .from("poplog3_title_availability")
    .select(
      "tmdb_id, media_type, provider_id, provider_name, provider_logo_path, tmdb_provider_id, country, availability_type, source, deep_link, quality, last_synced_at"
    )
    .eq("media_type", mediaType)
    .eq("tmdb_id", tmdbId)
    .eq("country", country)
    .order("availability_type", { ascending: true })
    .order("provider_name", { ascending: true });

  if (error) {
    console.error("[availability-cache/get]", error);
    return [];
  }

  return (data ?? []) as AvailabilityRow[];
}

export function isAvailabilityFresh(
  rows: AvailabilityRow[],
  maxAgeDays = 7
): boolean {
  if (rows.length === 0) return false;
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
  const { tmdbId, mediaType, country, source, rows } = input;

  // Cross-reference: para cada providerName/tmdbProviderId, tenta achar o
  // streaming_providers.id (catalogo de providers).
  const lookupKeys = rows
    .map((r) => r.tmdbProviderId)
    .filter((v): v is number => typeof v === "number");

  const providerLookup = new Map<number, string>();
  if (lookupKeys.length > 0) {
    const { data: providers } = await supabaseAdmin
      .from("streaming_providers")
      .select("id, tmdb_provider_id")
      .in("tmdb_provider_id", lookupKeys);
    for (const p of (providers ?? []) as Array<{
      id: string;
      tmdb_provider_id: number;
    }>) {
      providerLookup.set(p.tmdb_provider_id, p.id);
    }
  }

  const { error: delErr } = await supabaseAdmin
    .from("poplog3_title_availability")
    .delete()
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .eq("country", country)
    .eq("source", source);

  if (delErr) {
    console.error("[availability-cache/replace/delete]", delErr);
    throw new Error(`Falha ao limpar availability: ${delErr.message}`);
  }

  if (rows.length === 0) return;

  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    tmdb_id: tmdbId,
    media_type: mediaType,
    provider_id: r.tmdbProviderId
      ? providerLookup.get(r.tmdbProviderId) ?? null
      : null,
    provider_name: r.providerName,
    provider_logo_path: r.providerLogoPath ?? null,
    tmdb_provider_id: r.tmdbProviderId ?? null,
    country,
    availability_type: r.availabilityType,
    source,
    deep_link: r.deepLink ?? null,
    quality: r.quality ?? null,
    raw_payload: r.rawPayload ?? null,
    last_synced_at: now,
    updated_at: now,
  }));

  const { error: insErr } = await supabaseAdmin
    .from("poplog3_title_availability")
    .insert(payload);

  if (insErr) {
    console.error("[availability-cache/replace/insert]", insErr);
    throw new Error(`Falha ao inserir availability: ${insErr.message}`);
  }
}

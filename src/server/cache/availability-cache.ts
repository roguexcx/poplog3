import { supabaseAdmin } from "@/server/supabase/admin";
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

const AVAILABILITY_SELECT_FULL =
  "tmdb_id, media_type, provider_id, provider_name, provider_logo_path, tmdb_provider_id, country, availability_type, source, deep_link, quality, last_synced_at, provider_confidence, last_checked_at, expires_at, fallback_checked_at, fallback_result, fallback_source, next_fallback_allowed_at";

const AVAILABILITY_SELECT_LEGACY =
  "tmdb_id, media_type, provider_id, provider_name, provider_logo_path, tmdb_provider_id, country, availability_type, source, deep_link, quality, last_synced_at";

const OPTIONAL_SCHEMA_COLUMNS = [
  "provider_confidence",
  "last_checked_at",
  "expires_at",
  "fallback_checked_at",
  "fallback_result",
  "fallback_source",
  "next_fallback_allowed_at",
];

function missingOptionalColumns(error: unknown) {
  const normalized = formatError(error);
  const haystack = [normalized.message, normalized.details, normalized.hint]
    .filter(Boolean)
    .join(" ");

  if (!/schema cache|column|PGRST204/i.test(haystack)) return [];

  return OPTIONAL_SCHEMA_COLUMNS.filter((column) => haystack.includes(column));
}

function logIncompleteAvailabilitySchema(columns: string[]) {
  const missing = columns.length > 0 ? columns : OPTIONAL_SCHEMA_COLUMNS;
  logOnce(
    "availability:schema-incomplete",
    [
      "[availability] schema incompleto",
      ...missing.map((column) => `- ${column} ausente`),
      "- fallback simplificado aplicado",
    ].join("\n"),
  );
}

export async function getAvailability(
  mediaType: MediaType,
  tmdbId: number,
  country: string
): Promise<AvailabilityRow[]> {
  const { data, error } = await supabaseAdmin
    .from("poplog3_title_availability")
    .select(AVAILABILITY_SELECT_FULL)
    .eq("media_type", mediaType)
    .eq("tmdb_id", tmdbId)
    .eq("country", country)
    .order("availability_type", { ascending: true })
    .order("provider_name", { ascending: true });

  if (error) {
    const missing = missingOptionalColumns(error);
    if (missing.length > 0) {
      logIncompleteAvailabilitySchema(missing);
      const { data: legacyData, error: legacyError } = await supabaseAdmin
        .from("poplog3_title_availability")
        .select(AVAILABILITY_SELECT_LEGACY)
        .eq("media_type", mediaType)
        .eq("tmdb_id", tmdbId)
        .eq("country", country)
        .order("availability_type", { ascending: true })
        .order("provider_name", { ascending: true });

      if (!legacyError) return (legacyData ?? []) as AvailabilityRow[];
    }

    logOnce(
      `availability:get:${formatError(error).code ?? formatError(error).message}`,
      "[availability] leitura do cache falhou\n- fallback aplicado: sem providers em cache",
      formatError(error),
      "error",
    );
    return [];
  }

  return (data ?? []) as AvailabilityRow[];
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

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const expiresAt = new Date(
    nowDate.getTime() + (input.ttlDays ?? 7) * 24 * 60 * 60 * 1000,
  ).toISOString();
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
    provider_confidence: r.providerConfidence ?? source,
    last_checked_at: now,
    expires_at: expiresAt,
    fallback_checked_at: input.fallback?.checkedAt ?? null,
    fallback_result: input.fallback?.result ?? null,
    fallback_source: input.fallback?.source ?? null,
    next_fallback_allowed_at: input.fallback?.nextAllowedAt ?? null,
    updated_at: now,
  }));

  const { error: insErr } = await supabaseAdmin
    .from("poplog3_title_availability")
    .insert(payload);

  if (insErr) {
    const missing = missingOptionalColumns(insErr);
    if (missing.length > 0) {
      logIncompleteAvailabilitySchema(missing);
      const legacyPayload = payload.map((row) => {
        const legacyRow: Record<string, unknown> = { ...row };
        for (const column of OPTIONAL_SCHEMA_COLUMNS) {
          delete legacyRow[column];
        }
        return legacyRow;
      });
      const { error: legacyInsertError } = await supabaseAdmin
        .from("poplog3_title_availability")
        .insert(legacyPayload);

      if (!legacyInsertError) return;
    }

    logOnce(
      `availability:replace-insert:${formatError(insErr).code ?? formatError(insErr).message}`,
      "[availability] escrita do cache falhou\n- fallback aplicado: providers não persistidos",
      formatError(insErr),
      "error",
    );
    throw new Error(`Falha ao inserir availability: ${insErr.message}`);
  }
}

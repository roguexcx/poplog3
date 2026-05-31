/**
 * Normalizer de disponibilidade (providers / onde assistir).
 *
 * Substitui normalize-provider.ts com suporte a múltiplas fontes,
 * região explícita, confiança e validade (TTL).
 *
 * Regras de UI (conforme plano de migração):
 *   - confidence high | medium + expires_at futuro → exibir normalmente
 *   - confidence low | predicted | unverified → "Disponibilidade indicada, aguardando confirmação"
 *   - confidence stale → "Disponibilidade pode estar desatualizada"
 *   - sem dados → "Disponibilidade ainda não confirmada" (não chamar TMDB)
 */

export type AvailabilitySource =
  | "balloonerismm"
  | "watchmode"
  | "motn"
  | "local"
  | "manual"
  | "future_provider";

export type AvailabilityConfidence =
  | "high"
  | "medium"
  | "low"
  | "predicted"
  | "stale"
  | "unverified";

export type ProviderType =
  | "subscription"
  | "rent"
  | "buy"
  | "free"
  | "unknown";

/** Provider normalizado com todos os campos de confiança e validade */
export type NormalizedAvailability = {
  providerName: string;
  providerRegion: string;
  providerType: ProviderType;
  providerLogoUrl?: string;
  providerUrl?: string;
  source: AvailabilitySource;
  sourceConfidence: AvailabilityConfidence;
  checkedAt: string;  // ISO timestamp
  expiresAt: string;  // ISO timestamp
  evidencePayloadHash?: string;
};

/** Sinal de indisponibilidade para UI — não chamar TMDB */
export type AvailabilityUnavailable = {
  available: false;
  message: "not_confirmed";
};

export const AVAILABILITY_UNAVAILABLE: AvailabilityUnavailable = {
  available: false,
  message: "not_confirmed",
};

// ─── Helpers de UI ────────────────────────────────────────────────────────────

/**
 * Retorna o texto de UI adequado para a confiança do provider.
 */
export function getAvailabilityDisplayStatus(
  provider: NormalizedAvailability,
): "confirmed" | "pending_confirmation" | "stale" | "unavailable" {
  const now = new Date();
  const expires = new Date(provider.expiresAt);

  if (expires < now) return "stale";
  if (provider.sourceConfidence === "high" || provider.sourceConfidence === "medium") return "confirmed";
  if (provider.sourceConfidence === "stale") return "stale";
  return "pending_confirmation";
}

export function getAvailabilityUiMessage(status: ReturnType<typeof getAvailabilityDisplayStatus>): string {
  switch (status) {
    case "confirmed": return "";
    case "pending_confirmation": return "Disponibilidade indicada, aguardando confirmação";
    case "stale": return "Disponibilidade pode estar desatualizada";
    case "unavailable": return "Disponibilidade ainda não confirmada";
  }
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

type RawProviderInput = {
  name: string;
  region: string;
  type?: string;
  logoUrl?: string | null;
  url?: string | null;
  source: AvailabilitySource;
  confidence?: AvailabilityConfidence;
  checkedAt?: string;
  ttlSeconds?: number;
  evidencePayloadHash?: string;
};

/**
 * Normaliza um provider bruto para o contrato NormalizedAvailability.
 */
export function normalizeAvailability(input: RawProviderInput): NormalizedAvailability {
  const now = new Date();
  const ttl = input.ttlSeconds ?? 86_400; // 1 dia padrão
  const expires = new Date(now.getTime() + ttl * 1_000);

  const type = normalizeProviderType(input.type);
  const confidence = input.confidence ?? inferConfidence(input.source);

  return {
    providerName: input.name,
    providerRegion: input.region.toUpperCase(),
    providerType: type,
    providerLogoUrl: input.logoUrl ?? undefined,
    providerUrl: input.url ?? undefined,
    source: input.source,
    sourceConfidence: confidence,
    checkedAt: input.checkedAt ?? now.toISOString(),
    expiresAt: expires.toISOString(),
    evidencePayloadHash: input.evidencePayloadHash,
  };
}

function normalizeProviderType(raw?: string): ProviderType {
  if (!raw) return "unknown";
  const normalized = raw.toLowerCase();
  if (normalized.includes("subscription") || normalized.includes("flatrate")) return "subscription";
  if (normalized.includes("rent")) return "rent";
  if (normalized.includes("buy") || normalized.includes("purchase")) return "buy";
  if (normalized.includes("free") || normalized.includes("ads")) return "free";
  return "unknown";
}

function inferConfidence(source: AvailabilitySource): AvailabilityConfidence {
  switch (source) {
    case "balloonerismm": return "medium"; // sobe para "high" quando IMDb ID confirmado
    case "watchmode": return "medium";
    case "motn": return "medium";
    case "local": return "high";
    case "manual": return "high";
    case "future_provider": return "unverified";
  }
}

/**
 * Eleva a confiança quando o IMDb ID está confirmado no payload.
 * Balloonerismm com IMDb ID → high; sem ID → medium.
 */
export function elevateConfidenceWithImdbId(
  provider: NormalizedAvailability,
  imdbId: string | null | undefined,
): NormalizedAvailability {
  if (!imdbId || !imdbId.startsWith("tt")) return provider;
  if (provider.sourceConfidence === "medium" && provider.source === "balloonerismm") {
    return { ...provider, sourceConfidence: "high" };
  }
  return provider;
}

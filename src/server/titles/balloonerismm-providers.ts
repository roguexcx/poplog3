/**
 * Providers/disponibilidade experimental via Balloonerismm.
 *
 * IMPORTANTE: Balloonerismm NÃO pode ser persistido em Poplog3TitleAvailability
 * porque o enum AvailabilitySource só aceita tmdb | watchmode | motn.
 *
 * Se futuramente for necessário persistir, a migration mínima seria:
 *   ALTER TABLE poplog3_title_availability
 *   MODIFY COLUMN source ENUM('tmdb','watchmode','motn','balloonerismm');
 *   (risco: baixo, rollback seguro removendo o valor do enum)
 *
 * Por ora, providers Balloonerismm são retornados apenas via debug endpoint.
 *
 * Feature flags:
 *   BALLOONERISMM_PROVIDERS_ENABLED=false     — produção desabilitada
 *   BALLOONERISMM_PROVIDERS_DEBUG_ONLY=true   — permite via debug endpoint
 */

import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";
import type { BalloonerismMovie, BalloonerismShow, BalloonerismProvider } from "@/server/api-clients/balloonerismm/types";

// ─── Feature flags ─────────────────────────────────────────────────────────────

export function isProvidersEnabled(): boolean {
  const flag = process.env.BALLOONERISMM_PROVIDERS_ENABLED;
  if (!flag) return false;
  return flag !== "false" && flag !== "0";
}

export function isProvidersDebugOnly(): boolean {
  const flag = process.env.BALLOONERISMM_PROVIDERS_DEBUG_ONLY;
  if (!flag) return false;
  return flag !== "false" && flag !== "0";
}

// ─── Tipos normalizados ────────────────────────────────────────────────────────

export type NormalizedProvider = {
  name: string;
  type: "subscription" | "rent" | "buy" | "free" | "ads" | "unknown";
  logoUrl: string | null;
  region: string | null;
  url: string | null;
  source: "balloonerismm";
};

function normalizeProviderType(
  raw: string | undefined,
): NormalizedProvider["type"] {
  switch (raw) {
    case "subscription": return "subscription";
    case "rent":         return "rent";
    case "buy":          return "buy";
    case "free":         return "free";
    case "ads":          return "ads";
    default:             return "unknown";
  }
}

function normalizeProvider(p: BalloonerismProvider): NormalizedProvider {
  return {
    name: p.name,
    type: normalizeProviderType(p.type),
    logoUrl: p.logo_url ?? null,
    region: p.region ?? null,
    url: p.url ?? null,
    source: "balloonerismm",
  };
}

// ─── Fetch providers ───────────────────────────────────────────────────────────

/**
 * Busca providers do Balloonerismm para um título via IMDb ID.
 *
 * Retorna null quando:
 *   - BALLOONERISMM_PROVIDERS_ENABLED=false E BALLOONERISMM_PROVIDERS_DEBUG_ONLY=false
 *   - Balloonerismm está inativo (BALLOONERISMM_ACTIVE=false)
 *   - API retorna erro ou título não tem providers
 *
 * Nunca persiste em DB — use apenas para debug/enrichment.
 */
export async function getBalloonerismProviders(
  imdbId: string,
  mediaType: "movie" | "tv",
  region?: string,
): Promise<NormalizedProvider[] | null> {
  if (!isProvidersEnabled() && !isProvidersDebugOnly()) return null;

  const path = mediaType === "movie" ? `/movie/${imdbId}` : `/tv/${imdbId}`;
  const data = await balloonerismGet<BalloonerismMovie | BalloonerismShow>(path, {
    ttlSeconds: 3600,
  });

  if (!data?.providers || data.providers.length === 0) return null;

  let providers = data.providers.map(normalizeProvider);

  if (region) {
    const filtered = providers.filter(
      (p) => !p.region || p.region.toUpperCase() === region.toUpperCase(),
    );
    // Só filtra se houver resultados — evita retornar vazio por região desconhecida
    if (filtered.length > 0) providers = filtered;
  }

  return providers;
}

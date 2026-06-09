/**
 * Watch providers via Balloonerismm — fonte primária de disponibilidade.
 *
 * Endpoints:
 *   GET /movie/{imdbId}/watch/providers?region=BR
 *   GET /tv/{imdbId}/watch/providers?region=BR
 *
 * Retorna dados no formato JustWatch/TMDB: results[region]{ flatrate, rent, buy, free, ads }.
 * Usa `resolveCatalogImage` para normalizar logo_path → URL completa.
 * Sem persistência em DB — dado ao vivo com cache de processo (TTL 1h).
 */

import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";
import type {
  BalloonerismWatchProvidersResponse,
  BalloonerismWatchProviderItem,
  BalloonerismWatchRegionData,
} from "@/server/api-clients/balloonerismm/types";
import { resolveCatalogImage } from "@/lib/images/resolve";
import type { TitleProvider } from "@/features/title/types";

const DEFAULT_REGION = "BR";
const PROVIDERS_TTL = 3600; // 1h — dados de disponibilidade mudam raramente

// ─── Normalização ────────────────────────────────────────────────────────────

type ProviderCategory = "streaming" | "rent" | "buy" | "free" | "ads";

/**
 * Valida se uma URL é um deeplink útil para o usuário.
 * Rejeita links IMDb (/watch) — a rota existe mas retorna 404 na maioria dos títulos.
 * Só aceita URLs absolutas de serviços de streaming reais ou JustWatch.
 */
function isValidDeepLink(url: string | null | undefined): url is string {
  if (!url || typeof url !== "string") return false;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  const lower = url.toLowerCase();
  // IMDb /watch não é um deeplink de streaming — rejeita
  if (lower.includes("imdb.com")) return false;
  return true;
}

function normalizeLogo(item: BalloonerismWatchProviderItem): string | null {
  return resolveCatalogImage(item.logo_url ?? item.logo_path, "w92");
}

function normalizeName(item: BalloonerismWatchProviderItem): string | null {
  const name = item.provider_name ?? item.name;
  return name && name.trim() ? name.trim() : null;
}

function itemsToProviders(
  items: BalloonerismWatchProviderItem[] | undefined,
  type: ProviderCategory,
  deepLinkFallback?: string | null,
): TitleProvider[] {
  if (!items?.length) return [];
  return items
    .map((item): TitleProvider | null => {
      const name = normalizeName(item);
      if (!name) return null;
      // Prefere o link específico do item; fallback para o link regional (JustWatch);
      // rejeita qualquer link IMDb que não seja um deeplink real de streaming
      const deepLink = isValidDeepLink(item.link)
        ? item.link
        : isValidDeepLink(deepLinkFallback)
          ? deepLinkFallback
          : null;
      return {
        name,
        logoUrl: normalizeLogo(item),
        type: type === "streaming" ? "streaming" : type,
        source: "balloonerismm",
        deepLink,
        country: DEFAULT_REGION,
      };
    })
    .filter((p): p is TitleProvider => p !== null);
}

function normalizeRegionData(
  regionData: BalloonerismWatchRegionData,
  region: string,
): TitleProvider[] {
  if (!regionData) return [];

  // Usa o link regional apenas se for JustWatch ou serviço real (não IMDb)
  const link = isValidDeepLink(regionData.link) ? regionData.link : null;

  return [
    ...itemsToProviders(regionData.flatrate, "streaming", link),
    ...itemsToProviders(regionData.free,     "free",      link),
    ...itemsToProviders(regionData.ads,      "ads",       link),
    ...itemsToProviders(regionData.rent,     "rent",      link),
    ...itemsToProviders(regionData.buy,      "buy",       link),
  ];
}

// ─── Fetch principal ─────────────────────────────────────────────────────────

/**
 * Busca watch providers do Balloonerismm para um título via IMDb ID.
 *
 * - Sempre retorna BR como região padrão.
 * - Nunca lança — retorna [] em caso de erro ou indisponibilidade.
 * - Cache de processo: 1h por path.
 */
export async function getBalloonerismWatchProviders(
  imdbId: string,
  mediaType: "movie" | "tv",
  region = DEFAULT_REGION,
): Promise<TitleProvider[]> {
  const segment = mediaType === "movie" ? "movie" : "tv";
  const path = `/${segment}/${imdbId}/watch/providers`;

  const data = await balloonerismGet<BalloonerismWatchProvidersResponse>(path, {
    params: { region },
    ttlSeconds: PROVIDERS_TTL,
  });

  if (!data?.results) return [];

  // Tenta a região solicitada; se vazia, tenta qualquer região disponível como fallback
  const regionData = data.results[region.toUpperCase()]
    ?? data.results[region.toLowerCase()]
    ?? null;

  if (regionData) return normalizeRegionData(regionData, region);

  // Fallback: se só há uma região disponível, usa ela
  const available = Object.values(data.results);
  if (available.length === 1) return normalizeRegionData(available[0], region);

  return [];
}

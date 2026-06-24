import { db } from "@/server/db/client";
import type { TitleProvider } from "@/features/title/types";
import {
  CANONICAL_PROVIDER_LOGOS,
  CANONICAL_PROVIDER_NAMES,
} from "@/lib/streaming/provider-display";
import {
  normalizeTitleProvider,
  resolveProviderFamily,
  type ProviderAccessKind,
} from "@/server/streaming/provider-normalization";

/**
 * Catálogo canônico de serviços selecionáveis no Perfil.
 *
 * Espelha exatamente o seed da migração `00000000000011_provider_normalization`
 * (mesmos IDs estáveis), mas vive no código para que o catálogo possa ser
 * re-aplicado de forma idempotente caso o banco tenha sido criado via `db push`,
 * caso o seed da migração não tenha rodado, ou caso a tabela esteja vazia por
 * qualquer outro motivo. Os IDs são estáveis de propósito: as preferências do
 * usuário (`user_streaming_preferences.provider_id`) referenciam esses IDs.
 */
export type ProviderCatalogEntry = {
  id: string;
  name: string;
  providerSlug: string;
  normalizedName: string;
  rootKey: string;
  rootName: string;
  variantKey: string;
  variantName: string | null;
  accessKind: ProviderAccessKind;
  defaultPriority: number;
  isActive: boolean;
  logoPath?: string | null;
};

type ProviderCatalogEntryWithFamily = ProviderCatalogEntry & {
  familyKey: string;
  familyName: string;
};

export const STREAMING_PROVIDER_CATALOG_BR: ProviderCatalogEntry[] = [
  { id: "provider-netflix-direct-br", name: "Netflix", providerSlug: "netflix-direct", normalizedName: "Netflix", rootKey: "netflix", rootName: "Netflix", variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 10, isActive: true },
  { id: "provider-netflix-ads-br", name: "Netflix Standard with Ads", providerSlug: "netflix-ads", normalizedName: "Netflix com anúncios", rootKey: "netflix", rootName: "Netflix", variantKey: "ads", variantName: "Com anúncios", accessKind: "ads", defaultPriority: 10, isActive: true },
  { id: "provider-max-direct-br", name: CANONICAL_PROVIDER_NAMES.max, logoPath: CANONICAL_PROVIDER_LOGOS.max, providerSlug: "max-direct", normalizedName: CANONICAL_PROVIDER_NAMES.max, rootKey: "max", rootName: CANONICAL_PROVIDER_NAMES.max, variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 40, isActive: true },
  { id: "provider-hbo-max-legacy-br", name: "HBO Max", logoPath: CANONICAL_PROVIDER_LOGOS.max, providerSlug: "hbo-max-legacy", normalizedName: CANONICAL_PROVIDER_NAMES.max, rootKey: "max", rootName: CANONICAL_PROVIDER_NAMES.max, variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 40, isActive: false },
  { id: "provider-max-prime-channel-br", name: "HBO Max Amazon Channel", logoPath: CANONICAL_PROVIDER_LOGOS.maxPrimeChannel, providerSlug: "max-prime-channel", normalizedName: `${CANONICAL_PROVIDER_NAMES.max} via Prime Video`, rootKey: "max", rootName: CANONICAL_PROVIDER_NAMES.max, variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 40, isActive: true },
  { id: "provider-max-apple-channel-br", name: "HBO Max Apple TV Channel", logoPath: CANONICAL_PROVIDER_LOGOS.max, providerSlug: "max-apple-channel", normalizedName: `${CANONICAL_PROVIDER_NAMES.max} via Apple TV`, rootKey: "max", rootName: CANONICAL_PROVIDER_NAMES.max, variantKey: "apple-tv-channel", variantName: "Via Apple TV", accessKind: "partner_channel", defaultPriority: 40, isActive: true },
  { id: "provider-prime-direct-br", name: "Amazon Prime Video", providerSlug: "prime-video-direct", normalizedName: "Prime Video", rootKey: "prime-video", rootName: "Prime Video", variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 20, isActive: true },
  { id: "provider-prime-ads-br", name: "Amazon Prime Video with Ads", providerSlug: "prime-video-ads", normalizedName: "Prime Video com anúncios", rootKey: "prime-video", rootName: "Prime Video", variantKey: "ads", variantName: "Com anúncios", accessKind: "ads", defaultPriority: 20, isActive: true },
  { id: "provider-prime-store-br", name: "Amazon Video", providerSlug: "prime-video-store", normalizedName: "Prime Video aluguel/compra", rootKey: "prime-video", rootName: "Prime Video", variantKey: "rent-buy", variantName: "Aluguel/compra", accessKind: "rent_buy", defaultPriority: 20, isActive: true },
  { id: "provider-disney-direct-br", name: "Disney Plus", providerSlug: "disney-plus-direct", normalizedName: "Disney+", rootKey: "disney-plus", rootName: "Disney+", variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 30, isActive: true },
  { id: "provider-apple-direct-br", name: "Apple TV Plus", logoPath: CANONICAL_PROVIDER_LOGOS.appleTvPlus, providerSlug: "apple-tv-plus-direct", normalizedName: "Apple TV+", rootKey: "apple-tv-plus", rootName: "Apple TV+", variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 50, isActive: true },
  { id: "provider-apple-prime-channel-br", name: "Apple TV Amazon Channel", logoPath: CANONICAL_PROVIDER_LOGOS.appleTvPrimeChannel, providerSlug: "apple-tv-plus-prime-channel", normalizedName: "Apple TV+ via Prime Video", rootKey: "apple-tv-plus", rootName: "Apple TV+", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 50, isActive: true },
  { id: "provider-apple-store-br", name: "Apple TV Store", logoPath: CANONICAL_PROVIDER_LOGOS.appleTvStore, providerSlug: "apple-tv-store", normalizedName: "Apple TV aluguel/compra", rootKey: "apple-tv-store", rootName: "Apple TV", variantKey: "rent-buy", variantName: "Aluguel/compra", accessKind: "rent_buy", defaultPriority: 55, isActive: true },
  { id: "provider-globoplay-direct-br", name: "Globoplay", providerSlug: "globoplay-direct", normalizedName: "Globoplay", rootKey: "globoplay", rootName: "Globoplay", variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 60, isActive: true },
  { id: "provider-globoplay-prime-channel-br", name: "Globoplay Amazon Channel", providerSlug: "globoplay-prime-channel", normalizedName: "Globoplay via Prime Video", rootKey: "globoplay", rootName: "Globoplay", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 60, isActive: true },
  { id: "provider-paramount-direct-br", name: "Paramount Plus", providerSlug: "paramount-plus-direct", normalizedName: "Paramount+", rootKey: "paramount-plus", rootName: "Paramount+", variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 70, isActive: true },
  { id: "provider-paramount-prime-channel-br", name: "Paramount+ Amazon Channel", logoPath: CANONICAL_PROVIDER_LOGOS.paramountPrimeChannel, providerSlug: "paramount-plus-prime-channel", normalizedName: "Paramount+ via Prime Video", rootKey: "paramount-plus", rootName: "Paramount+", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 70, isActive: true },
  { id: "provider-paramount-apple-channel-br", name: "Paramount Plus Apple TV Channel", logoPath: CANONICAL_PROVIDER_LOGOS.paramountAppleChannel, providerSlug: "paramount-plus-apple-channel", normalizedName: "Paramount+ via Apple TV", rootKey: "paramount-plus", rootName: "Paramount+", variantKey: "apple-tv-channel", variantName: "Via Apple TV", accessKind: "partner_channel", defaultPriority: 70, isActive: true },
  { id: "provider-crunchyroll-direct-br", name: "Crunchyroll", providerSlug: "crunchyroll-direct", normalizedName: "Crunchyroll", rootKey: "crunchyroll", rootName: "Crunchyroll", variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 80, isActive: true },
  { id: "provider-mubi-direct-br", name: "MUBI", providerSlug: "mubi-direct", normalizedName: "MUBI", rootKey: "mubi", rootName: "MUBI", variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 90, isActive: true },
  { id: "provider-mubi-prime-channel-br", name: "MUBI Amazon Channel", logoPath: CANONICAL_PROVIDER_LOGOS.mubiPrimeChannel, providerSlug: "mubi-prime-channel", normalizedName: "MUBI via Prime Video", rootKey: "mubi", rootName: "MUBI", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 90, isActive: true },
  { id: "provider-telecine-direct-br", name: "Telecine Play", providerSlug: "telecine-direct", normalizedName: "Telecine", rootKey: "telecine", rootName: "Telecine", variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 100, isActive: true },
  { id: "provider-pluto-free-br", name: "Pluto TV", providerSlug: "pluto-tv-free", normalizedName: "Pluto TV grátis", rootKey: "pluto-tv", rootName: "Pluto TV", variantKey: "free", variantName: "Grátis", accessKind: "free", defaultPriority: 110, isActive: true },
  { id: "provider-mercado-free-br", name: "Mercado Play", providerSlug: "mercado-play-free", normalizedName: "Mercado Play grátis", rootKey: "mercado-play", rootName: "Mercado Play", variantKey: "free", variantName: "Grátis", accessKind: "free", defaultPriority: 120, isActive: true },
  { id: "provider-plex-free-br", name: "Plex", providerSlug: "plex-free", normalizedName: "Plex grátis", rootKey: "plex", rootName: "Plex", variantKey: "free", variantName: "Grátis", accessKind: "free", defaultPriority: 130, isActive: true },
  { id: "provider-netmovies-free-br", name: "NetMovies", providerSlug: "netmovies-free", normalizedName: "NetMovies grátis", rootKey: "netmovies", rootName: "NetMovies", variantKey: "free", variantName: "Grátis", accessKind: "free", defaultPriority: 140, isActive: true },
  { id: "provider-claro-direct-br", name: "Claro Video", providerSlug: "claro-video-direct", normalizedName: "Claro Video", rootKey: "claro-video", rootName: "Claro Video", variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 150, isActive: true },
  { id: "provider-youtube-direct-br", name: "YouTube Premium", providerSlug: "youtube-direct", normalizedName: "YouTube", rootKey: "youtube", rootName: "YouTube", variantKey: "direct", variantName: null, accessKind: "included", defaultPriority: 170, isActive: true },
  { id: "provider-google-store-br", name: "Google Play Movies", providerSlug: "google-play-store", normalizedName: "Google Play aluguel/compra", rootKey: "google-play", rootName: "Google Play", variantKey: "rent-buy", variantName: "Aluguel/compra", accessKind: "rent_buy", defaultPriority: 180, isActive: true },
  // ── Canais (Amazon Channels / Apple TV Channels) selecionáveis no Perfil ──────────────
  // Vendidos DENTRO do Prime Video / Apple TV mas com catálogo próprio. Antes, títulos que
  // só estão nesses canais apareciam como "Prime Video" genérico. Mantê-los no catálogo os
  // torna selecionáveis no Perfil e categorizados como "canais". IDs estáveis (upsert).
  { id: "provider-telecine-prime-channel-br", name: "Telecine Amazon Channel", logoPath: CANONICAL_PROVIDER_LOGOS.telecinePrimeChannel, providerSlug: "telecine-prime-channel", normalizedName: "Telecine via Prime Video", rootKey: "telecine", rootName: "Telecine", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 100, isActive: true },
  { id: "provider-mgm-prime-channel-br", name: "MGM+ Amazon Channel", logoPath: CANONICAL_PROVIDER_LOGOS.mgmPrimeChannel, providerSlug: "mgm-plus-prime-channel", normalizedName: "MGM+ via Prime Video", rootKey: "mgm-plus", rootName: "MGM+", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 190, isActive: true },
  { id: "provider-mgm-apple-channel-br", name: "MGM+ Apple TV Channel", logoPath: CANONICAL_PROVIDER_LOGOS.mgmAppleChannel, providerSlug: "mgm-plus-apple-channel", normalizedName: "MGM+ via Apple TV", rootKey: "mgm-plus", rootName: "MGM+", variantKey: "apple-tv-channel", variantName: "Via Apple TV", accessKind: "partner_channel", defaultPriority: 190, isActive: true },
  { id: "provider-universal-prime-channel-br", name: "Universal+ Amazon Channel", logoPath: CANONICAL_PROVIDER_LOGOS.universalPrimeChannel, providerSlug: "universal-plus-prime-channel", normalizedName: "Universal+ via Prime Video", rootKey: "universal-plus", rootName: "Universal+", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 200, isActive: true },
  { id: "provider-diamond-prime-channel-br", name: "Diamond Films Amazon Channel", logoPath: CANONICAL_PROVIDER_LOGOS.diamondPrimeChannel, providerSlug: "diamond-films-prime-channel", normalizedName: "Diamond Films via Prime Video", rootKey: "diamond-films", rootName: "Diamond Films", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 220, isActive: true },
  { id: "provider-reserva-prime-channel-br", name: "Reserva Imovision Amazon Channel", providerSlug: "reserva-imovision-prime-channel", normalizedName: "Reserva Imovision via Prime Video", rootKey: "reserva-imovision", rootName: "Reserva Imovision", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 230, isActive: true },
  { id: "provider-looke-prime-channel-br", name: "Looke Amazon Channel", logoPath: CANONICAL_PROVIDER_LOGOS.lookePrimeChannel, providerSlug: "looke-prime-channel", normalizedName: "Looke via Prime Video", rootKey: "looke", rootName: "Looke", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 240, isActive: true },
  { id: "provider-belas-artes-prime-channel-br", name: "Belas Artes à La Carte Amazon Channel", providerSlug: "belas-artes-prime-channel", normalizedName: "Belas Artes à La Carte via Prime Video", rootKey: "belas-artes", rootName: "Belas Artes à La Carte", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 250, isActive: true },
  { id: "provider-filmbox-prime-channel-br", name: "Filmbox Amazon Channel", providerSlug: "filmbox-prime-channel", normalizedName: "Filmbox via Prime Video", rootKey: "filmbox", rootName: "Filmbox", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 260, isActive: true },
  { id: "provider-lionsgate-prime-channel-br", name: "Lionsgate+ Amazon Channel", providerSlug: "lionsgate-plus-prime-channel", normalizedName: "Lionsgate+ via Prime Video", rootKey: "lionsgate-plus", rootName: "Lionsgate+", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 270, isActive: true },
  { id: "provider-filmelier-prime-channel-br", name: "Filmelier+ Amazon Channel", providerSlug: "filmelier-plus-prime-channel", normalizedName: "Filmelier+ via Prime Video", rootKey: "filmelier-plus", rootName: "Filmelier+", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 280, isActive: true },
  { id: "provider-o2play-prime-channel-br", name: "O2Play Amazon Channel", providerSlug: "o2play-prime-channel", normalizedName: "O2Play via Prime Video", rootKey: "o2play", rootName: "O2Play", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 290, isActive: true },
  { id: "provider-curta-on-prime-channel-br", name: "Curta!On Amazon Channel", providerSlug: "curta-on-prime-channel", normalizedName: "Curta!On via Prime Video", rootKey: "curta-on", rootName: "Curta!On", variantKey: "prime-video-channel", variantName: "Via Prime Video", accessKind: "partner_channel", defaultPriority: 300, isActive: true },
];

export function getProviderCatalog(country: string): ProviderCatalogEntry[] {
  // Hoje só temos catálogo curado para o BR. Outros países caem para o BR como
  // base segura até existir um catálogo dedicado.
  void country;
  return STREAMING_PROVIDER_CATALOG_BR;
}

function withFamily(entry: ProviderCatalogEntry): ProviderCatalogEntryWithFamily {
  return {
    ...entry,
    ...resolveProviderFamily({
      rootKey: entry.rootKey,
      rootName: entry.rootName,
      variantKey: entry.variantKey,
      accessKind: entry.accessKind,
    }),
  };
}

function shouldReplaceCatalogLogo(
  existingLogoPath: string | null,
  entry: ProviderCatalogEntryWithFamily,
): boolean {
  if (entry.logoPath === undefined) return false;
  if (!existingLogoPath) return true;
  return existingLogoPath !== entry.logoPath;
}

/**
 * Garante que o catálogo curado exista no banco para o país informado.
 *
 * Idempotente: prefere IDs estáveis do catálogo e corrige aliases curados
 * obsoletos (ex.: Max → HBO MAX) sem mexer em rows dinâmicas fora desse escopo.
 *
 * Retorna o número de linhas garantidas, ou `null` se o seed falhou (por
 * exemplo, colunas da migração ainda não aplicadas). Nunca lança.
 */
export async function ensureStreamingProviderCatalog(country = "BR"): Promise<number | null> {
  const entries = getProviderCatalog(country).map(withFamily);
  try {
    for (const entry of entries) {
      const existingById = await db.streamingProvider.findUnique({
        where: { id: entry.id },
        select: { id: true, logoPath: true },
      });
      const existingByIdentity = existingById ? null : await db.streamingProvider.findFirst({
        where: {
          country,
          rootKey: entry.rootKey,
          variantKey: entry.variantKey,
          id: { not: entry.id },
        },
        select: { id: true, logoPath: true },
      });
      const existing =
        existingById ??
        (entry.id === "provider-max-direct-br" &&
        existingByIdentity?.id === "provider-hbo-max-legacy-br"
          ? null
          : existingByIdentity);

      if (existing) {
        await db.streamingProvider.update({
          where: { id: existing.id },
          data: {
            providerSlug: entry.providerSlug,
            normalizedName: entry.normalizedName,
            rootKey: entry.rootKey,
            rootName: entry.rootName,
            familyKey: entry.familyKey,
            familyName: entry.familyName,
            variantKey: entry.variantKey,
            variantName: entry.variantName,
            accessKind: entry.accessKind,
            defaultPriority: entry.defaultPriority,
            isActive: entry.isActive,
            country,
            name: entry.name,
            ...(shouldReplaceCatalogLogo(existing.logoPath, entry) ? { logoPath: entry.logoPath ?? null } : {}),
          },
        });
      } else {
        await db.streamingProvider.create({
          data: {
            id: entry.id,
            name: entry.name,
            logoPath: entry.logoPath ?? null,
            providerSlug: entry.providerSlug,
            normalizedName: entry.normalizedName,
            rootKey: entry.rootKey,
            rootName: entry.rootName,
            familyKey: entry.familyKey,
            familyName: entry.familyName,
            variantKey: entry.variantKey,
            variantName: entry.variantName,
            accessKind: entry.accessKind,
            defaultPriority: entry.defaultPriority,
            isActive: entry.isActive,
            country,
          },
        });
      }
    }
    return entries.length;
  } catch (error) {
    console.error("[provider-catalog] ensureStreamingProviderCatalog failed", {
      country,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

const SELECTABLE_DISCOVERED_ACCESS = new Set<ProviderAccessKind>([
  "included",
  "ads",
  "partner_channel",
  "free",
  "rent_buy",
]);

function stableDiscoveredId(provider: TitleProvider, country: string): string {
  const rootKey = provider.rootKey ?? "unknown";
  const variantKey = provider.variantKey ?? "direct";
  return `provider-${rootKey}-${variantKey}-${country.toLowerCase()}`
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function discoveredEntryFromProvider(
  rawProvider: TitleProvider,
  country: string,
): ProviderCatalogEntryWithFamily | null {
  const provider = normalizeTitleProvider(rawProvider);
  const accessKind = provider.accessKind ?? "unknown";
  if (!SELECTABLE_DISCOVERED_ACCESS.has(accessKind)) return null;
  if (!provider.rootKey || !provider.rootName || !provider.variantKey) return null;

  const normalizedName = provider.name?.trim();
  if (!normalizedName) return null;

  return withFamily({
    id: stableDiscoveredId(provider, country),
    name: provider.originalName ?? provider.name,
    providerSlug: `${provider.rootKey}-${provider.variantKey}`,
    normalizedName,
    rootKey: provider.rootKey,
    rootName: provider.rootName,
    variantKey: provider.variantKey,
    variantName: provider.variantName ?? null,
    accessKind,
    defaultPriority: provider.defaultPriority ?? 1_000,
    isActive: true,
    logoPath: provider.logoUrl ?? null,
  });
}

/**
 * Promove providers/canais descobertos ao catálogo selecionável do Perfil.
 *
 * O catálogo curado cobre os principais canais conhecidos, mas a JustWatch pode entregar
 * novos pacotes a qualquer momento. Fazemos upsert por identidade raiz+variante+país,
 * preservando o nome original recebido da fonte e sem depender de IDs externos.
 */
export async function ensureDiscoveredStreamingProviders(
  providers: TitleProvider[],
  country = "BR",
): Promise<number | null> {
  const entriesByIdentity = new Map<string, ProviderCatalogEntryWithFamily>();
  for (const provider of providers) {
    const entry = discoveredEntryFromProvider(provider, country);
    if (!entry) continue;
    entriesByIdentity.set(`${entry.rootKey}:${entry.variantKey}`, entry);
  }

  const entries = [...entriesByIdentity.values()];
  if (entries.length === 0) return 0;

  try {
    for (const entry of entries) {
      const existing = await db.streamingProvider.findFirst({
        where: {
          country,
          rootKey: entry.rootKey,
          variantKey: entry.variantKey,
        },
        select: { id: true, logoPath: true },
      });

      if (existing) {
        await db.streamingProvider.update({
          where: { id: existing.id },
          data: {
            providerSlug: entry.providerSlug,
            normalizedName: entry.normalizedName,
            rootName: entry.rootName,
            familyKey: entry.familyKey,
            familyName: entry.familyName,
            variantName: entry.variantName,
            accessKind: entry.accessKind,
            defaultPriority: entry.defaultPriority,
            isActive: true,
            ...(existing.logoPath ? {} : { logoPath: entry.logoPath }),
          },
        });
      } else {
        await db.streamingProvider.create({
          data: {
            id: entry.id,
            name: entry.name,
            logoPath: entry.logoPath ?? null,
            providerSlug: entry.providerSlug,
            normalizedName: entry.normalizedName,
            rootKey: entry.rootKey,
            rootName: entry.rootName,
            familyKey: entry.familyKey,
            familyName: entry.familyName,
            variantKey: entry.variantKey,
            variantName: entry.variantName,
            accessKind: entry.accessKind,
            defaultPriority: entry.defaultPriority,
            isActive: entry.isActive,
            country,
          },
        });
      }
    }

    return entries.length;
  } catch (error) {
    console.error("[provider-catalog] ensureDiscoveredStreamingProviders failed", {
      country,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

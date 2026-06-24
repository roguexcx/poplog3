import { db } from "@/server/db/client";
import { ensureStreamingProviderCatalog } from "@/server/streaming/provider-catalog";
import {
  normalizeProvider,
  type ProviderAccessKind,
  type ProviderCategory,
  type ProviderDisplayPreference,
} from "@/server/streaming/provider-normalization";

export type StreamingProviderLocal = {
  id: string;
  provider_name: string;
  provider_slug: string | null;
  logo_url: string | null;
  tmdb_provider_id: number | null;
  country: string;
  is_active: boolean;
  original_name: string;
  normalized_name: string;
  root_key: string;
  root_name: string;
  family_key: string;
  family_name: string;
  variant_key: string;
  variant_name: string | null;
  access_kind: ProviderAccessKind;
  default_priority: number;
  category: ProviderCategory;
  brand_color: string;
  text_color: string;
  short_label: string;
};

export type UserStreamingPreferenceLocal = {
  provider_id: string;
  country: string;
  is_enabled: boolean;
  priority_order: number;
};

const catalogEnsuredCountries = new Set<string>();

async function queryActiveStreamingProviderRows(country: string) {
  return db.streamingProvider.findMany({
    where: {
      country,
      isActive: true,
    },
    orderBy: [{ defaultPriority: "asc" }, { name: "asc" }],
  });
}

function providerTypeToNormalizationType(type: string | null | undefined) {
  if (type === "subscription") return "subscription";
  if (type === "rent" || type === "buy" || type === "free" || type === "ads") return type;
  return null;
}

function rememberLogo(input: {
  normalized: NonNullable<ReturnType<typeof normalizeProvider>>;
  logoUrl: string | null | undefined;
  logoByIdentity: Map<string, string>;
  logoByRootKey: Map<string, string>;
}) {
  const logoUrl = input.normalized.logoPath ?? input.logoUrl ?? null;
  if (!logoUrl) return;
  const identity = `${input.normalized.rootKey}:${input.normalized.variantKey}`;
  if (!input.logoByIdentity.has(identity)) input.logoByIdentity.set(identity, logoUrl);
  if (!input.logoByRootKey.has(input.normalized.rootKey)) {
    input.logoByRootKey.set(input.normalized.rootKey, logoUrl);
  }
}

async function addDiscoveredLogoFallbacks(input: {
  country: string;
  logoByIdentity: Map<string, string>;
  logoByRootKey: Map<string, string>;
}) {
  try {
    const rows = await db.catalogAvailability.findMany({
      where: {
        providerRegion: input.country,
        providerLogoUrl: { not: null },
      },
      select: {
        providerName: true,
        providerLogoUrl: true,
        providerType: true,
      },
      orderBy: { checkedAt: "desc" },
      take: 500,
    });

    for (const row of rows) {
      const normalized = normalizeProvider(
        row.providerName,
        row.providerLogoUrl,
        providerTypeToNormalizationType(row.providerType),
      );
      if (!normalized) continue;
      rememberLogo({
        normalized,
        logoUrl: row.providerLogoUrl,
        logoByIdentity: input.logoByIdentity,
        logoByRootKey: input.logoByRootKey,
      });
    }
  } catch {
    // O Perfil não deve falhar por ausência/estado da tabela auxiliar de disponibilidade.
  }
}

export async function listActiveStreamingProviders(country = "BR"): Promise<StreamingProviderLocal[]> {
  let rows = await queryActiveStreamingProviderRows(country);

  // Reaplica o catálogo curado uma vez por processo mesmo quando a tabela já tem
  // linhas: bancos locais antigos podem ter só um subconjunto dos canais.
  if (!catalogEnsuredCountries.has(country)) {
    const seeded = await ensureStreamingProviderCatalog(country);
    catalogEnsuredCountries.add(country);
    if (seeded) {
      rows = await queryActiveStreamingProviderRows(country);
    }
  } else if (rows.length === 0) {
    // Fallback seguro para bancos criados via `db push` ou seed ausente.
    const seeded = await ensureStreamingProviderCatalog(country);
    if (seeded) rows = await queryActiveStreamingProviderRows(country);
  }

  const normalizedById = new Map<string, ReturnType<typeof normalizeProvider>>();
  const logoByIdentity = new Map<string, string>();
  const logoByRootKey = new Map<string, string>();
  for (const row of rows) {
    const normalized = normalizeProvider(row.name, row.logoPath);
    normalizedById.set(row.id, normalized);
    if (normalized) {
      rememberLogo({
        normalized,
        logoUrl: row.logoPath,
        logoByIdentity,
        logoByRootKey,
      });
    }
  }
  await addDiscoveredLogoFallbacks({ country, logoByIdentity, logoByRootKey });

  return rows.map((row) => {
    const normalized = normalizedById.get(row.id);
    const fallbackKey = row.providerSlug ?? row.id;
    const rootKey = normalized?.rootKey ?? row.rootKey ?? fallbackKey;
    const persistedAccess = row.accessKind as ProviderAccessKind | null;
    const hasExplicitAccess = Boolean(persistedAccess && persistedAccess !== "included");
    const variantKey = hasExplicitAccess
      ? row.variantKey ?? normalized?.variantKey ?? "direct"
      : normalized?.variantKey ?? row.variantKey ?? "direct";
    const accessKind = hasExplicitAccess
      ? persistedAccess!
      : normalized?.accessKind ?? persistedAccess ?? "unknown";
    return {
      id: row.id,
      provider_name: row.name,
      provider_slug: row.providerSlug,
      logo_url:
        normalized?.logoPath ??
        logoByIdentity.get(`${rootKey}:${variantKey}`) ??
        logoByRootKey.get(rootKey) ??
        row.logoPath,
      tmdb_provider_id: row.tmdbProviderId,
      country: row.country,
      is_active: row.isActive,
      original_name: row.name,
      normalized_name: normalized?.name ?? row.normalizedName ?? row.name,
      root_key: rootKey,
      root_name: normalized?.rootName ?? row.rootName ?? row.name,
      family_key: normalized?.familyKey ?? row.familyKey ?? fallbackKey,
      family_name: normalized?.familyName ?? row.familyName ?? row.name,
      variant_key: variantKey,
      variant_name: hasExplicitAccess
        ? row.variantName ?? normalized?.variantName ?? null
        : normalized?.variantName ?? row.variantName ?? null,
      access_kind: accessKind,
      default_priority: row.defaultPriority ?? normalized?.defaultPriority ?? 1_000,
      category: normalized?.presentation.category ?? "outros",
      brand_color: normalized?.presentation.brandColor ?? "#444444",
      text_color: normalized?.presentation.textColor ?? "#ffffff",
      short_label: normalized?.presentation.shortLabel ?? row.name.slice(0, 2).toUpperCase(),
    };
  });
}

export async function listUserStreamingPreferences(
  userId: string,
  country = "BR",
): Promise<UserStreamingPreferenceLocal[]> {
  const rows = await db.userStreamingPreference.findMany({
    where: {
      userId,
      country,
    },
    orderBy: { priorityOrder: "asc" },
  });

  return rows.map((row) => ({
    provider_id: row.providerId,
    country: row.country,
    is_enabled: row.isEnabled,
    priority_order: row.priorityOrder,
  }));
}

export async function replaceUserStreamingPreferences(input: {
  userId: string;
  country?: string;
  providerIds: string[];
}): Promise<void> {
  const country = input.country ?? "BR";
  const now = new Date();
  const uniqueIds = [...new Set(input.providerIds)];
  const validProviders = await db.streamingProvider.findMany({
    where: { id: { in: uniqueIds }, country, isActive: true },
    select: { id: true },
  });
  const validIds = new Set(validProviders.map((provider) => provider.id));
  const orderedIds = uniqueIds.filter((id) => validIds.has(id));

  await db.$transaction([
    db.userStreamingPreference.updateMany({
      where: { userId: input.userId, country },
      data: { isEnabled: false, priorityOrder: 999, updatedAt: now },
    }),
    ...orderedIds.map((providerId, index) =>
      db.userStreamingPreference.upsert({
        where: {
          userId_providerId_country: { userId: input.userId, providerId, country },
        },
        update: { isEnabled: true, priorityOrder: index + 1, updatedAt: now },
        create: {
          userId: input.userId,
          providerId,
          country,
          isEnabled: true,
          priorityOrder: index + 1,
        },
      }),
    ),
  ]);
}

/** Preferências já convertidas para a identidade global raiz+variante. */
export async function getUserProviderDisplayPreferences(input: {
  userId: string;
  country?: string;
}): Promise<ProviderDisplayPreference[]> {
  const rows = await db.userStreamingPreference.findMany({
    where: {
      userId: input.userId,
      country: input.country ?? "BR",
      isEnabled: true,
    },
    include: { provider: true },
    orderBy: { priorityOrder: "asc" },
  });

  return rows.map((row) => {
    const normalized = normalizeProvider(row.provider.name, row.provider.logoPath);
    const persistedAccess = row.provider.accessKind as ProviderAccessKind | null;
    const hasExplicitAccess = Boolean(persistedAccess && persistedAccess !== "included");
    return {
      rootKey: normalized?.rootKey ?? row.provider.rootKey ?? row.provider.id,
      variantKey: hasExplicitAccess
        ? row.provider.variantKey ?? normalized?.variantKey ?? "direct"
        : normalized?.variantKey ?? row.provider.variantKey ?? "direct",
      priorityOrder: row.priorityOrder,
    };
  });
}

export async function getFavoriteTmdbProviderIds(input: {
  userId: string;
  country?: string;
}): Promise<number[]> {
  const rows = await db.userStreamingPreference.findMany({
    where: {
      userId: input.userId,
      country: input.country ?? "BR",
      isEnabled: true,
    },
    include: {
      provider: true,
    },
    orderBy: { priorityOrder: "asc" },
  });

  return rows
    .map((row) => row.provider.tmdbProviderId)
    .filter((id): id is number => typeof id === "number");
}

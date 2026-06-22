import type { TitleProvider, TitleProviderType } from "@/features/title/types";

export type ProviderAccessKind =
  | "included"
  | "ads"
  | "partner_channel"
  | "rent"
  | "buy"
  | "rent_buy"
  | "free"
  | "unknown";

export type NormalizedProvider = {
  /** Nome seguro para UI, preservando a variação de acesso. */
  name: string;
  /** Nome recebido da fonte. Nunca deve ser sobrescrito ao persistir. */
  originalName: string;
  rootKey: string;
  rootName: string;
  variantKey: string;
  variantName: string | null;
  accessKind: ProviderAccessKind;
  isOfficial: boolean;
  defaultPriority: number;
  logoPath: string | null;
};

/** Tipo de oferta normalizado (compartilhado pelo Hero/continuidade). */
export type AvailabilityType = "subscription" | "rent" | "buy" | "free" | "ads";

/** Confiança da disponibilidade por fonte (vocabulário herdado do pipeline anterior). */
export type ProviderConfidence =
  | "tmdb_only"
  | "watchmode_confirmed"
  | "movieofthenight_confirmed"
  | "mixed_confirmed"
  | "predicted_window"
  | "user_relevant_confirmed";

export type ProviderDisplayPreference = {
  rootKey: string;
  variantKey: string;
  priorityOrder: number;
};

type RootDefinition = {
  key: string;
  name: string;
  aliases: string[];
  defaultPriority: number;
  logoPath?: string | null;
};

const ROOTS: RootDefinition[] = [
  { key: "netflix", name: "Netflix", aliases: ["netflix"], defaultPriority: 10 },
  {
    key: "prime-video",
    name: "Prime Video",
    aliases: ["prime video", "amazon prime video", "amazon video"],
    defaultPriority: 20,
  },
  { key: "disney-plus", name: "Disney+", aliases: ["disney+", "disney plus"], defaultPriority: 30 },
  { key: "hbo-max", name: "HBO Max", aliases: ["hbo max", "hbomax", "max", "max.com"], defaultPriority: 40 },
  {
    key: "apple-tv-plus",
    name: "Apple TV+",
    aliases: ["apple tv+", "appletv+", "apple tv plus", "apple tv"],
    defaultPriority: 50,
    logoPath: "/68MNrwlkpF7WnmNPXLah69CR5cb.jpg",
  },
  { key: "globoplay", name: "Globoplay", aliases: ["globoplay"], defaultPriority: 60 },
  { key: "paramount-plus", name: "Paramount+", aliases: ["paramount+", "paramount plus"], defaultPriority: 70 },
  { key: "crunchyroll", name: "Crunchyroll", aliases: ["crunchyroll"], defaultPriority: 80 },
  { key: "mubi", name: "MUBI", aliases: ["mubi"], defaultPriority: 90 },
  { key: "telecine", name: "Telecine", aliases: ["telecine", "telecine play"], defaultPriority: 100 },
  { key: "pluto-tv", name: "Pluto TV", aliases: ["pluto tv"], defaultPriority: 110 },
  { key: "mercado-play", name: "Mercado Play", aliases: ["mercado play"], defaultPriority: 120 },
  { key: "plex", name: "Plex", aliases: ["plex"], defaultPriority: 130 },
  { key: "netmovies", name: "NetMovies", aliases: ["netmovies"], defaultPriority: 140 },
  { key: "claro-video", name: "Claro Video", aliases: ["claro video"], defaultPriority: 150 },
  { key: "star-plus", name: "Star+", aliases: ["star+", "star plus"], defaultPriority: 160 },
  { key: "youtube", name: "YouTube", aliases: ["youtube", "youtube premium"], defaultPriority: 170 },
  { key: "google-play", name: "Google Play", aliases: ["google play movies", "google play"], defaultPriority: 180 },
];

const ROOT_BY_ALIAS = new Map(
  ROOTS.flatMap((root) => root.aliases.map((alias) => [normalizeProviderKey(alias), root] as const)),
);

/**
 * Normaliza o tipo de oferta retornando `null` quando o valor é desconhecido.
 * Mantido aqui porque Hero/continuidade também consomem esse vocabulário.
 */
export function normalizeAvailabilityTypeOrNull(
  type?: string | null,
): AvailabilityType | null {
  switch (type) {
    case "flatrate":
    case "subscription":
    case "streaming":
      return "subscription";
    case "free":
      return "free";
    case "ads":
      return "ads";
    case "rent":
      return "rent";
    case "buy":
      return "buy";
    default:
      return null;
  }
}

/** Deriva a confiança da disponibilidade a partir da fonte da linha de cache. */
export function resolveProviderConfidence(
  source?: string | null,
): ProviderConfidence {
  switch (source) {
    case "watchmode":
      return "watchmode_confirmed";
    case "movieofthenight":
      return "movieofthenight_confirmed";
    case "mixed":
      return "mixed_confirmed";
    case "predicted":
      return "predicted_window";
    case "user_relevant":
      return "user_relevant_confirmed";
    case "tmdb":
    default:
      return "tmdb_only";
  }
}

export function normalizeProviderKey(value: string | number | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

function slugify(value: string): string {
  return normalizeProviderKey(value)
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type VariantResolution = {
  baseName: string;
  variantKey: string;
  variantName: string | null;
  accessKind: ProviderAccessKind;
  isOfficial: boolean;
};

function resolveVariant(key: string, type?: TitleProviderType | AvailabilityType | null): VariantResolution {
  const hasAds = /(?:with ads|standard with ads|basic with ads|com anuncios|anuncios)/.test(key);
  if (hasAds || type === "ads") {
    return {
      baseName: key.replace(/\s+(?:standard |basic )?with ads$|\s+com anuncios$|\s+anuncios$/g, "").trim(),
      variantKey: "ads",
      variantName: "Com anúncios",
      accessKind: "ads",
      isOfficial: false,
    };
  }

  const partnerPatterns: Array<{ pattern: RegExp; key: string; label: string }> = [
    { pattern: /\s+(?:amazon|prime video)\s+channel$/, key: "prime-video-channel", label: "Via Prime Video" },
    { pattern: /\s+apple tv\s+channel$/, key: "apple-tv-channel", label: "Via Apple TV" },
    { pattern: /\s+roku(?:\s+premium)?\s+channel$/, key: "roku-channel", label: "Via Roku" },
    { pattern: /\s+channel$/, key: "partner-channel", label: "Via parceiro" },
  ];
  for (const partner of partnerPatterns) {
    if (partner.pattern.test(key)) {
      return {
        baseName: key.replace(partner.pattern, "").trim(),
        variantKey: partner.key,
        variantName: partner.label,
        accessKind: "partner_channel",
        isOfficial: false,
      };
    }
  }

  if (type === "rent") {
    return { baseName: key, variantKey: "rent", variantName: "Aluguel", accessKind: "rent", isOfficial: false };
  }
  if (type === "buy") {
    return { baseName: key, variantKey: "buy", variantName: "Compra", accessKind: "buy", isOfficial: false };
  }
  if (type === "free") {
    return { baseName: key, variantKey: "free", variantName: "Grátis", accessKind: "free", isOfficial: true };
  }

  if (key === "amazon video" || /(?:store|aluguel|compra|rent|buy)/.test(key)) {
    return {
      baseName: key.replace(/\s+(?:store|aluguel|compra|rent|buy).*$/g, "").trim(),
      variantKey: "rent-buy",
      variantName: "Aluguel/compra",
      accessKind: "rent_buy",
      isOfficial: false,
    };
  }

  return {
    baseName: key.replace(/\.com$/g, "").trim(),
    variantKey: "direct",
    variantName: null,
    accessKind: "included",
    isOfficial: true,
  };
}

function findRoot(baseName: string): RootDefinition | null {
  const exact = ROOT_BY_ALIAS.get(baseName);
  if (exact) return exact;

  // Algumas fontes acrescentam palavras técnicas depois da marca. O match por alias
  // mais longo evita que "apple tv" ganhe de "apple tv+", por exemplo.
  const candidates = ROOTS.flatMap((root) =>
    root.aliases.map((alias) => ({ root, alias: normalizeProviderKey(alias) })),
  ).sort((a, b) => b.alias.length - a.alias.length);
  return candidates.find(({ alias }) => baseName === alias || baseName.startsWith(`${alias} `))?.root ?? null;
}

export function normalizeProvider(
  providerName: string | null | undefined,
  logoPath?: string | null,
  type?: TitleProviderType | AvailabilityType | null,
): NormalizedProvider | null {
  const originalName = String(providerName ?? "").trim();
  const key = normalizeProviderKey(originalName);
  if (!key) return null;

  const variant = resolveVariant(key, type);
  // Amazon Video é a loja do Prime Video; após remover a semântica comercial,
  // ainda precisamos apontá-la explicitamente para a raiz Prime Video.
  const root = findRoot(variant.baseName) ?? findRoot(key);
  const fallbackRootName = titleCase(variant.baseName || key);
  const rootKey = root?.key ?? slugify(fallbackRootName);
  const rootName = root?.name ?? fallbackRootName;
  const displayName = variant.variantName ? `${rootName} ${variant.variantName.toLowerCase()}` : rootName;

  return {
    name: displayName,
    originalName,
    rootKey,
    rootName,
    variantKey: variant.variantKey,
    variantName: variant.variantName,
    accessKind: variant.accessKind,
    isOfficial: variant.isOfficial,
    defaultPriority: root?.defaultPriority ?? 1_000,
    logoPath: logoPath ?? root?.logoPath ?? null,
  };
}

/**
 * Enriquece um provider sem apagar sua identidade original. Esse contrato atravessa
 * cache, title page e cards compactos, portanto é intencionalmente serializável.
 */
export function normalizeTitleProvider(provider: TitleProvider): TitleProvider {
  const normalized = normalizeProvider(
    provider.originalName ?? provider.name,
    provider.logoUrl ?? provider.logoPath ?? null,
    provider.type,
  );
  if (!normalized) return provider;
  return {
    ...provider,
    name: normalized.name,
    originalName: normalized.originalName,
    rootKey: normalized.rootKey,
    rootName: normalized.rootName,
    variantKey: normalized.variantKey,
    variantName: normalized.variantName,
    accessKind: normalized.accessKind,
    isOfficial: normalized.isOfficial,
    defaultPriority: normalized.defaultPriority,
    logoUrl: provider.logoUrl ?? normalized.logoPath,
  };
}

function providerIdentity(provider: TitleProvider): string {
  const normalized = normalizeTitleProvider(provider);
  return [normalized.rootKey, normalized.variantKey, normalized.type].join(":");
}

/** Evita fragmentação visual mantendo o melhor payload de cada raiz+variante+oferta. */
export function dedupeTitleProviders(providers: TitleProvider[]): TitleProvider[] {
  const byIdentity = new Map<string, TitleProvider>();
  for (const rawProvider of providers) {
    const provider = normalizeTitleProvider(rawProvider);
    const key = providerIdentity(provider);
    const current = byIdentity.get(key);
    if (!current) {
      byIdentity.set(key, provider);
      continue;
    }
    byIdentity.set(key, {
      ...current,
      logoUrl: current.logoUrl ?? provider.logoUrl,
      deepLink: current.deepLink ?? provider.deepLink,
      deeplink: current.deeplink ?? provider.deeplink,
      quality: current.quality ?? provider.quality,
      originalName: current.originalName ?? provider.originalName,
    });
  }
  return [...byIdentity.values()];
}

function compareProviders(
  left: TitleProvider,
  right: TitleProvider,
  preferences: ProviderDisplayPreference[],
): number {
  const preferenceByRoot = new Map(preferences.map((preference) => [preference.rootKey, preference]));
  const leftPreference = left.rootKey ? preferenceByRoot.get(left.rootKey) : undefined;
  const rightPreference = right.rootKey ? preferenceByRoot.get(right.rootKey) : undefined;

  if (Boolean(leftPreference) !== Boolean(rightPreference)) return leftPreference ? -1 : 1;
  if (leftPreference && rightPreference) {
    if (leftPreference.priorityOrder !== rightPreference.priorityOrder) {
      return leftPreference.priorityOrder - rightPreference.priorityOrder;
    }
    const leftExact = left.variantKey === leftPreference.variantKey;
    const rightExact = right.variantKey === rightPreference.variantKey;
    if (leftExact !== rightExact) return leftExact ? -1 : 1;
  }

  if (Boolean(left.isOfficial) !== Boolean(right.isOfficial)) return left.isOfficial ? -1 : 1;
  const priorityDifference = (left.defaultPriority ?? 1_000) - (right.defaultPriority ?? 1_000);
  if (priorityDifference !== 0) return priorityDifference;
  return left.name.localeCompare(right.name, "pt-BR");
}

/**
 * Ordem global: serviços escolhidos (ordem manual), variante exata dentro da raiz,
 * oficial da raiz e, por fim, demais providers na ordem padrão do catálogo.
 */
export function rankTitleProviders(
  providers: TitleProvider[],
  preferences: ProviderDisplayPreference[] = [],
): TitleProvider[] {
  const preferenceByRoot = new Map(preferences.map((preference) => [preference.rootKey, preference]));
  return dedupeTitleProviders(providers)
    .map((provider) => ({
      ...provider,
      isPreferred: provider.rootKey ? preferenceByRoot.has(provider.rootKey) : false,
      preferenceOrder: provider.rootKey ? preferenceByRoot.get(provider.rootKey)?.priorityOrder : undefined,
      isExactPreference:
        Boolean(provider.rootKey && preferenceByRoot.get(provider.rootKey)?.variantKey === provider.variantKey),
    }))
    .sort((left, right) => compareProviders(left, right, preferences));
}

/** Compatibilidade para imports existentes. */
export function normalizeTitleProviders(providers: TitleProvider[]): TitleProvider[] {
  return dedupeTitleProviders(providers);
}

import type { TitleProvider, TitleProviderType } from "@/features/title/types";
import {
  CANONICAL_PROVIDER_NAMES,
  CANONICAL_PROVIDER_LOGOS,
  getCanonicalProviderLogoUrl,
} from "@/lib/streaming/provider-display";

export type ProviderAccessKind =
  | "included"
  | "ads"
  | "partner_channel"
  | "rent"
  | "buy"
  | "rent_buy"
  | "free"
  | "unknown";

export type ProviderCategory = "principais" | "gratuitos" | "canais" | "aluguel" | "outros";

export type ProviderPresentation = {
  category: ProviderCategory;
  brandColor: string;
  textColor: string;
  shortLabel: string;
};

export type NormalizedProvider = {
  /** Nome seguro para UI, preservando a variação de acesso. */
  name: string;
  /** Nome recebido da fonte. Nunca deve ser sobrescrito ao persistir. */
  originalName: string;
  rootKey: string;
  rootName: string;
  /** Família de assinatura. Mantida separada para permitir grupos multi-marca no futuro. */
  familyKey: string;
  familyName: string;
  variantKey: string;
  variantName: string | null;
  accessKind: ProviderAccessKind;
  isOfficial: boolean;
  defaultPriority: number;
  logoPath: string | null;
  presentation: ProviderPresentation;
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
  presentation: ProviderPresentation;
};

function presentation(
  brandColor: string,
  shortLabel: string,
  category: ProviderCategory = "principais",
  textColor = "#ffffff",
): ProviderPresentation {
  return { category, brandColor, textColor, shortLabel };
}

type ProviderFamilyResolution = {
  familyKey: string;
  familyName: string;
};

const CHANNEL_VARIANT_FAMILIES: Record<string, ProviderFamilyResolution> = {
  "prime-video-channel": { familyKey: "prime-video", familyName: "Prime Video" },
  "apple-tv-channel": { familyKey: "apple-tv-plus", familyName: "Apple TV+" },
  "roku-channel": { familyKey: "roku", familyName: "Roku" },
  "partner-channel": { familyKey: "partner-channels", familyName: "Canais parceiros" },
};

export function resolveProviderFamily(input: {
  rootKey: string;
  rootName: string;
  variantKey: string;
  accessKind?: ProviderAccessKind | string | null;
}): ProviderFamilyResolution {
  if (input.accessKind === "partner_channel") {
    return CHANNEL_VARIANT_FAMILIES[input.variantKey] ?? CHANNEL_VARIANT_FAMILIES["partner-channel"];
  }

  return {
    familyKey: input.rootKey,
    familyName: input.rootName,
  };
}

const ROOTS: RootDefinition[] = [
  {
    key: "netflix",
    name: "Netflix",
    aliases: ["netflix"],
    defaultPriority: 10,
    logoPath: CANONICAL_PROVIDER_LOGOS.netflix,
    presentation: presentation("#E50914", "N"),
  },
  {
    key: "prime-video",
    name: "Prime Video",
    aliases: ["prime video", "amazon prime video", "amazon video"],
    defaultPriority: 20,
    logoPath: CANONICAL_PROVIDER_LOGOS.primeVideo,
    presentation: presentation("#00A8E1", "P"),
  },
  { key: "disney-plus", name: "Disney+", aliases: ["disney+", "disney plus"], defaultPriority: 30, logoPath: CANONICAL_PROVIDER_LOGOS.disneyPlus, presentation: presentation("#113CCF", "D+") },
  {
    key: "max",
    name: CANONICAL_PROVIDER_NAMES.max,
    aliases: ["hbo max", "hbomax", "max", "max.com"],
    defaultPriority: 40,
    logoPath: getCanonicalProviderLogoUrl({ rootKey: "max" }),
    presentation: presentation("#002BE7", "M"),
  },
  {
    key: "apple-tv-plus",
    name: "Apple TV+",
    aliases: ["apple tv+", "appletv+", "apple tv plus", "appletv plus"],
    defaultPriority: 50,
    logoPath: CANONICAL_PROVIDER_LOGOS.appleTvPlus,
    presentation: presentation("#1C1C1E", "▶"),
  },
  {
    key: "apple-tv-store",
    name: "Apple TV",
    aliases: ["apple tv store", "appletv store", "itunes", "apple itunes"],
    defaultPriority: 55,
    logoPath: CANONICAL_PROVIDER_LOGOS.appleTvStore,
    presentation: presentation("#1C1C1E", "AT", "aluguel"),
  },
  { key: "globoplay", name: "Globoplay", aliases: ["globoplay"], defaultPriority: 60, logoPath: CANONICAL_PROVIDER_LOGOS.globoplay, presentation: presentation("#D50032", "G") },
  { key: "paramount-plus", name: "Paramount+", aliases: ["paramount+", "paramount plus"], defaultPriority: 70, logoPath: CANONICAL_PROVIDER_LOGOS.paramountPlus, presentation: presentation("#0064FF", "P+") },
  { key: "crunchyroll", name: "Crunchyroll", aliases: ["crunchyroll"], defaultPriority: 80, logoPath: CANONICAL_PROVIDER_LOGOS.crunchyroll, presentation: presentation("#F47521", "CR") },
  { key: "mubi", name: "MUBI", aliases: ["mubi"], defaultPriority: 90, logoPath: CANONICAL_PROVIDER_LOGOS.mubi, presentation: presentation("#2C2C2C", "MB") },
  { key: "telecine", name: "Telecine", aliases: ["telecine", "telecine play"], defaultPriority: 100, logoPath: CANONICAL_PROVIDER_LOGOS.telecinePrimeChannel, presentation: presentation("#003087", "TC", "canais") },
  { key: "pluto-tv", name: "Pluto TV", aliases: ["pluto tv"], defaultPriority: 110, logoPath: CANONICAL_PROVIDER_LOGOS.plutoTv, presentation: presentation("#1F1D36", "PT", "gratuitos") },
  { key: "mercado-play", name: "Mercado Play", aliases: ["mercado play"], defaultPriority: 120, presentation: presentation("#FFE600", "MP", "gratuitos", "#000000") },
  { key: "plex", name: "Plex", aliases: ["plex"], defaultPriority: 130, presentation: presentation("#E5A00D", "PX", "gratuitos", "#000000") },
  { key: "netmovies", name: "NetMovies", aliases: ["netmovies"], defaultPriority: 140, presentation: presentation("#2D2D2D", "NM", "gratuitos") },
  { key: "claro-video", name: "Claro Video", aliases: ["claro video", "claro tv+"], defaultPriority: 150, logoPath: CANONICAL_PROVIDER_LOGOS.claroVideo, presentation: presentation("#CC0000", "CV", "outros") },
  { key: "star-plus", name: "Star+", aliases: ["star+", "star plus"], defaultPriority: 160, presentation: presentation("#0A2A6E", "S+") },
  { key: "youtube", name: "YouTube", aliases: ["youtube", "youtube premium"], defaultPriority: 170, presentation: presentation("#FF0000", "YT", "outros") },
  { key: "google-play", name: "Google Play", aliases: ["google play movies", "google play"], defaultPriority: 180, presentation: presentation("#34A853", "GP", "aluguel") },
  { key: "roku", name: "Roku", aliases: ["roku", "roku channel"], defaultPriority: 185, presentation: presentation("#662D91", "R", "outros") },
  { key: "mgm-plus", name: "MGM+", aliases: ["mgm+", "mgm plus"], defaultPriority: 190, presentation: presentation("#C4A020", "MG", "canais", "#000000") },
  { key: "universal-plus", name: "Universal+", aliases: ["universal+", "universal plus"], defaultPriority: 200, logoPath: CANONICAL_PROVIDER_LOGOS.universalPrimeChannel, presentation: presentation("#2A2A2A", "U+", "canais") },
  { key: "wow", name: "WOW", aliases: ["wow", "wow presents plus"], defaultPriority: 210, presentation: presentation("#00C2FF", "W", "outros") },
  // ── Marcas que existem majoritariamente como CANAIS (Amazon/Apple TV Channels) no BR ──
  // Sem essas raízes, canais vindos da fonte (ex.: "Diamond Films Amazon Channel") caíam
  // num root slugificado sem cor/prioridade. Categoria "canais" reforça o agrupamento na UI
  // mesmo quando o accessKind já a derivaria — e dá marca/identidade estável ao Perfil.
  { key: "diamond-films", name: "Diamond Films", aliases: ["diamond films", "diamond filmes", "diamond"], defaultPriority: 220, presentation: presentation("#1A6BB5", "DF", "canais") },
  { key: "reserva-imovision", name: "Reserva Imovision", aliases: ["reserva imovision", "imovision"], defaultPriority: 230, presentation: presentation("#7A1F2B", "RI", "canais") },
  { key: "looke", name: "Looke", aliases: ["looke"], defaultPriority: 240, presentation: presentation("#E10098", "LK", "canais") },
  { key: "belas-artes", name: "Belas Artes à La Carte", aliases: ["belas artes a la carte", "belas artes", "belasartes a la carte"], defaultPriority: 250, presentation: presentation("#111111", "BA", "canais") },
  { key: "filmbox", name: "Filmbox", aliases: ["filmbox", "filmbox+", "filmbox plus"], defaultPriority: 260, presentation: presentation("#E2231A", "FB", "canais") },
  { key: "lionsgate-plus", name: "Lionsgate+", aliases: ["lionsgate+", "lionsgate plus", "lionsgate"], defaultPriority: 270, presentation: presentation("#1B1B1B", "LG", "canais") },
  { key: "filmelier-plus", name: "Filmelier+", aliases: ["filmelier+", "filmelier plus", "filmelier"], defaultPriority: 280, presentation: presentation("#FF3B30", "FL", "canais") },
  { key: "o2play", name: "O2Play", aliases: ["o2play", "o2 play"], defaultPriority: 290, presentation: presentation("#0098D8", "O2", "canais") },
  { key: "curta-on", name: "Curta!On", aliases: ["curta!on", "curta on", "curtaon"], defaultPriority: 300, presentation: presentation("#F39200", "CO", "canais", "#000000") },
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
    { pattern: /\s+via prime video$/, key: "prime-video-channel", label: "Via Prime Video" },
    { pattern: /\s+via apple tv$/, key: "apple-tv-channel", label: "Via Apple TV" },
    { pattern: /\s+via parceiro$/, key: "partner-channel", label: "Via parceiro" },
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

  if (/\s+channels?$/.test(key)) {
    return {
      baseName: key.replace(/\s+channels?$/, "").trim(),
      variantKey: "partner-channel",
      variantName: "Via parceiro",
      accessKind: "partner_channel",
      isOfficial: false,
    };
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

function resolveAmbiguousAppleTvRoot(key: string, variant: VariantResolution): RootDefinition | null {
  const isPlainAppleTv = key === "apple tv" || key === "appletv" || variant.baseName === "apple tv" || variant.baseName === "appletv";
  if (!isPlainAppleTv) return null;
  if (["rent", "buy", "rent_buy"].includes(variant.accessKind)) {
    return ROOT_BY_ALIAS.get("apple tv store") ?? null;
  }
  return ROOT_BY_ALIAS.get("apple tv plus") ?? null;
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
  const root = resolveAmbiguousAppleTvRoot(key, variant) ?? findRoot(variant.baseName) ?? findRoot(key);
  const fallbackRootName = titleCase(variant.baseName || key);
  const rootKey = root?.key ?? slugify(fallbackRootName);
  const rootName = root?.name ?? fallbackRootName;
  const displayVariant = variant.variantName
    ? `${variant.variantName.charAt(0).toLowerCase()}${variant.variantName.slice(1)}`
    : null;
  const displayName = displayVariant ? `${rootName} ${displayVariant}` : rootName;
  const family = resolveProviderFamily({
    rootKey,
    rootName,
    variantKey: variant.variantKey,
    accessKind: variant.accessKind,
  });
  const fallbackPresentation = presentation("#444444", (rootName || "?").slice(0, 2).toUpperCase(), "outros");
  const rootPresentation = root?.presentation ?? fallbackPresentation;
  const category: ProviderCategory =
    variant.accessKind === "partner_channel"
      ? "canais"
      : ["rent", "buy", "rent_buy"].includes(variant.accessKind)
        ? "aluguel"
        : variant.accessKind === "free"
          ? "gratuitos"
          : rootPresentation.category;

  return {
    name: displayName,
    originalName,
    rootKey,
    rootName,
    familyKey: family.familyKey,
    familyName: family.familyName,
    variantKey: variant.variantKey,
    variantName: variant.variantName,
    accessKind: variant.accessKind,
    isOfficial: variant.isOfficial,
    defaultPriority: root?.defaultPriority ?? 1_000,
    logoPath: getCanonicalProviderLogoUrl({
      rootKey,
      variantKey: variant.variantKey,
      name: displayName,
      logoUrl: logoPath ?? null,
    }),
    presentation: { ...rootPresentation, category },
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
    familyKey: normalized.familyKey,
    familyName: normalized.familyName,
    variantKey: normalized.variantKey,
    variantName: normalized.variantName,
    accessKind: normalized.accessKind,
    isOfficial: normalized.isOfficial,
    defaultPriority: normalized.defaultPriority,
    logoUrl: normalized.logoPath ?? provider.logoUrl ?? null,
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

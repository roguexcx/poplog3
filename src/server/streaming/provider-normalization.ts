import type { TitleProvider } from "@/features/title/types";

export type NormalizedProvider = {
  name: string;
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

/**
 * Normaliza o tipo de oferta retornando `null` quando o valor é desconhecido.
 * Mantido aqui (e não na camada global de availability) porque o Hero/continuidade
 * lê diretamente de `catalog_availability` e precisa distinguir "sem tipo".
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

const PROVIDER_ALIASES: Record<string, NormalizedProvider> = {
  "apple tv+": {
    name: "Apple TV+",
    logoPath: "/68MNrwlkpF7WnmNPXLah69CR5cb.jpg",
  },
  "appletv+": {
    name: "Apple TV+",
    logoPath: "/68MNrwlkpF7WnmNPXLah69CR5cb.jpg",
  },
  "apple tv plus": {
    name: "Apple TV+",
    logoPath: "/68MNrwlkpF7WnmNPXLah69CR5cb.jpg",
  },
  "apple tv": {
    name: "Apple TV+",
    logoPath: "/68MNrwlkpF7WnmNPXLah69CR5cb.jpg",
  },

  // A marca voltou a se chamar HBO Max — este é o nome canônico atual.
  // "Max" (e variações) é tratado como alias LEGADO e normalizado para "HBO Max".
  // Logo deixado como fallback (null): preferimos o logo vindo da fonte (provider.logoUrl);
  // quando não houver, o card/detalhe exibem o chip textual "HBO Max".
  "hbo max": {
    name: "HBO Max",
    logoPath: null,
  },
  "hbomax": {
    name: "HBO Max",
    logoPath: null,
  },
  "max": {
    name: "HBO Max",
    logoPath: null,
  },

  "amazon prime video": {
    name: "Prime Video",
    logoPath: null,
  },
  "amazon video": {
    name: "Prime Video",
    logoPath: null,
  },
  "prime video": {
    name: "Prime Video",
    logoPath: null,
  },

  "disney+": {
    name: "Disney+",
    logoPath: null,
  },
  "disney plus": {
    name: "Disney+",
    logoPath: null,
  },

  "globoplay": {
    name: "Globoplay",
    logoPath: null,
  },
  "star+": {
    name: "Star+",
    logoPath: null,
  },
};

export function normalizeProviderKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Reduz uma chave a sua forma "base" para casar com PROVIDER_ALIASES, removendo
 * sufixos de revenda/reseller e domínio que não mudam a identidade do serviço:
 *   "max.com"                 → "max"
 *   "hbo max amazon channel"  → "hbo max"
 *   "max amazon channel"      → "max"
 *   "paramount+ apple tv channel" → "paramount+"
 * Usado APENAS para o lookup de alias — o nome de fallback continua sendo o original,
 * então providers sem alias não têm o nome alterado.
 */
function aliasLookupKey(key: string): string {
  return key
    .replace(/\s+(amazon|apple tv|roku(?:\s+premium)?|google play|prime video)\s+channel$/g, "")
    .replace(/\.com$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeProvider(
  providerName: string | null | undefined,
  logoPath?: string | null
): NormalizedProvider | null {
  const key = normalizeProviderKey(providerName);

  if (!key) return null;

  // Casa o alias pela chave exata e, em seguida, pela chave "base" (sem sufixos de
  // revenda/domínio) — assim "Max", "max.com", "HBO Max Amazon Channel" → "HBO Max".
  const normalized = PROVIDER_ALIASES[key] ?? PROVIDER_ALIASES[aliasLookupKey(key)];

  if (normalized) {
    return {
      name: normalized.name,
      logoPath: normalized.logoPath ?? logoPath ?? null,
    };
  }

  return {
    name: providerName ?? "",
    logoPath: logoPath ?? null,
  };
}

/**
 * Normaliza um `TitleProvider` da camada global de availability aplicando
 * `PROVIDER_ALIASES`: canonicaliza o nome (ex.: "Max" → "HBO Max") e completa o
 * logo a partir do alias quando o provider não trouxe um (`logoUrl`).
 *
 * Aplicado UMA vez no pipeline canônico (availability-service) antes de agrupar e
 * de gravar em `catalog_availability`, garantindo nomes/logos consistentes em todas
 * as superfícies (Biblioteca, Detalhe, Hero, Acompanhando, Agenda, Busca, Recs).
 * Idempotente — reaplicar sobre um provider já normalizado não muda o resultado.
 */
export function normalizeTitleProvider(provider: TitleProvider): TitleProvider {
  const normalized = normalizeProvider(provider.name, provider.logoUrl ?? provider.logoPath ?? null);
  if (!normalized) return provider;
  return {
    ...provider,
    name: normalized.name || provider.name,
    // Preserva o logo do provider quando existir; senão usa o do alias.
    logoUrl: provider.logoUrl ?? normalized.logoPath ?? null,
  };
}

/** Normaliza uma lista de providers (atalho para `.map(normalizeTitleProvider)`). */
export function normalizeTitleProviders(providers: TitleProvider[]): TitleProvider[] {
  return providers.map(normalizeTitleProvider);
}
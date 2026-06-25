export const DEFAULT_CATALOG_LANGUAGE = "pt-BR";
export const DEFAULT_INTERFACE_LANGUAGE = "pt-BR";
export const DEFAULT_REGION = "BR";

const SUPPORTED_LANGUAGES = new Set(["pt-BR", "en-US"]);
const SUPPORTED_REGIONS = new Set(["BR", "US"]);

export type LocaleScope = {
  interfaceLanguage: string;
  catalogLanguage: string;
  region: string;
};

function normalizeLanguage(value: string | null | undefined, fallback: string): string {
  const raw = value?.trim();
  if (!raw) return fallback;
  const lower = raw.toLowerCase().replace("_", "-");
  const normalized =
    lower === "pt" || lower === "pt-br"
      ? "pt-BR"
      : lower === "en" || lower === "en-us"
        ? "en-US"
        : raw;

  return SUPPORTED_LANGUAGES.has(normalized) ? normalized : fallback;
}

export function normalizeCatalogLanguage(value?: string | null): string {
  return normalizeLanguage(value, DEFAULT_CATALOG_LANGUAGE);
}

export function normalizeInterfaceLanguage(value?: string | null): string {
  return normalizeLanguage(value, DEFAULT_INTERFACE_LANGUAGE);
}

export function normalizeCatalogRegion(value?: string | null): string {
  const normalized = value?.trim().toUpperCase();
  return normalized && SUPPORTED_REGIONS.has(normalized) ? normalized : DEFAULT_REGION;
}

export function resolveLocaleScope(input: {
  interfaceLanguage?: string | null;
  catalogLanguage?: string | null;
  language?: string | null;
  region?: string | null;
} = {}): LocaleScope {
  const interfaceLanguage = normalizeInterfaceLanguage(
    input.interfaceLanguage ?? input.language,
  );
  return {
    interfaceLanguage,
    catalogLanguage: normalizeCatalogLanguage(
      input.catalogLanguage ?? input.language ?? interfaceLanguage,
    ),
    region: normalizeCatalogRegion(input.region),
  };
}

export function localeCachePart(scope: Pick<LocaleScope, "catalogLanguage" | "region">): string {
  return `${scope.catalogLanguage}:${scope.region}`;
}

export function titleCacheKey(imdbId: string, scope: Pick<LocaleScope, "catalogLanguage" | "region">): string {
  return `title:${imdbId}:${localeCachePart(scope)}`;
}

export function posterCacheKey(imdbId: string, language = DEFAULT_CATALOG_LANGUAGE): string {
  return `poster:${imdbId}:${normalizeCatalogLanguage(language)}`;
}

export function providersCacheKey(imdbId: string, region = DEFAULT_REGION): string {
  return `providers:${imdbId}:${normalizeCatalogRegion(region)}`;
}

export function searchCacheKey(query: string, scope: Pick<LocaleScope, "catalogLanguage" | "region">): string {
  return `search:${query.trim().toLowerCase()}:${localeCachePart(scope)}`;
}


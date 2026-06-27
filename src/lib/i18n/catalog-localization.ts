/**
 * Localização canônica de metadados de catálogo (POPLOG).
 *
 * Mecanismo REUTILIZÁVEL: qualquer superfície que exiba título/sinopse/tagline
 * de catálogo (Home, Hero, Trending, busca, página de título, Radar, Sorteio,
 * Biblioteca, Para Você, SEO, OG image) deve guardar as versões recebidas das
 * fontes externas num objeto `CatalogLocalized` (uma entrada por idioma) e
 * resolver o idioma de exibição com `pickLocalized(...)`, em vez de traduzir
 * manualmente ou misturar idiomas.
 *
 * Regras:
 *  - NÃO traduzir manualmente. Apenas armazenar/normalizar/disponibilizar o que
 *    a fonte fornecer.
 *  - Idioma de catálogo (`catalogLanguage`) controla texto; nunca confundir com
 *    idioma de interface.
 *  - Fallback explícito e rastreável: quando o idioma pedido não tem dado, cai
 *    para o outro idioma e sinaliza `usedFallback` para métricas.
 */

export type CatalogLanguage = "pt-BR" | "en-US";

export const CATALOG_LANGUAGES: readonly CatalogLanguage[] = ["pt-BR", "en-US"];

export type LocalizedCatalogText = {
  title: string | null;
  overview: string | null;
  tagline: string | null;
};

export type CatalogLocalized = Record<CatalogLanguage, LocalizedCatalogText>;

export type CatalogLocalizationEntry = LocalizedCatalogText & {
  language: string;
  source?: string | null;
  hydratedAt?: Date | string | null;
};

export type CatalogLocalizationSubject = {
  title?: string | null;
  originalTitle?: string | null;
  overview?: string | null;
  tagline?: string | null;
  overviewLanguage?: string | null;
  localized?: Partial<CatalogLocalized> | null;
  localizations?: CatalogLocalizationEntry[] | null;
};

export type ResolvedCatalogLocalization = LocalizedCatalogText & {
  language: CatalogLanguage;
  requestedLanguage: CatalogLanguage;
  fallbackUsed: boolean;
  fallbackLanguage: CatalogLanguage | null;
};

export function emptyLocalizedText(): LocalizedCatalogText {
  return { title: null, overview: null, tagline: null };
}

/** Normaliza qualquer string de idioma para os dois idiomas de catálogo suportados. */
export function normalizeCatalogLanguageStrict(
  language: string | null | undefined,
): CatalogLanguage {
  const value = (language ?? "").trim().toLowerCase().replace("_", "-");
  return value === "en-us" || value === "en" ? "en-US" : "pt-BR";
}

/** Há pelo menos título OU sinopse no bloco localizado. */
export function hasLocalizedText(text: LocalizedCatalogText | null | undefined): boolean {
  return Boolean(text && ((text.title && text.title.trim()) || (text.overview && text.overview.trim())));
}

export type LocalizedPick = {
  text: LocalizedCatalogText;
  /** Idioma efetivamente usado (pode diferir do pedido em caso de fallback). */
  resolvedLanguage: CatalogLanguage;
  /** True quando o idioma pedido não tinha dado e caiu para o outro. */
  usedFallback: boolean;
};

/**
 * Resolve o texto localizado para o idioma pedido, com fallback explícito para
 * o outro idioma. Não inventa traduções: apenas escolhe entre o que existe.
 */
export function pickLocalized(
  localized: Partial<CatalogLocalized> | null | undefined,
  language: string | null | undefined,
): LocalizedPick {
  const requested = normalizeCatalogLanguageStrict(language);
  const other: CatalogLanguage = requested === "pt-BR" ? "en-US" : "pt-BR";

  const primary = localized?.[requested];
  if (hasLocalizedText(primary)) {
    return { text: primary as LocalizedCatalogText, resolvedLanguage: requested, usedFallback: false };
  }

  const fallback = localized?.[other];
  if (hasLocalizedText(fallback)) {
    return { text: fallback as LocalizedCatalogText, resolvedLanguage: other, usedFallback: true };
  }

  return {
    text: primary ?? fallback ?? emptyLocalizedText(),
    resolvedLanguage: requested,
    usedFallback: false,
  };
}

function compactText(value: string | null | undefined): string | null {
  const clean = value?.replace(/\s+/g, " ").trim();
  return clean ? clean : null;
}

function normalizeEntry(entry: CatalogLocalizationEntry): LocalizedCatalogText {
  return {
    title: compactText(entry.title),
    overview: compactText(entry.overview),
    tagline: compactText(entry.tagline),
  };
}

function mergeText(primary: LocalizedCatalogText, legacy: LocalizedCatalogText): LocalizedCatalogText {
  return {
    title: primary.title ?? legacy.title,
    overview: primary.overview ?? legacy.overview,
    tagline: primary.tagline ?? legacy.tagline,
  };
}

function localizedFromSubject(subject: CatalogLocalizationSubject): Partial<CatalogLocalized> {
  const localized: Partial<CatalogLocalized> = { ...(subject.localized ?? {}) };

  for (const entry of subject.localizations ?? []) {
    const language = normalizeCatalogLanguageStrict(entry.language);
    const current = localized[language] ?? emptyLocalizedText();
    localized[language] = mergeText(normalizeEntry(entry), current);
  }

  return localized;
}

/**
 * Resolve título/sinopse/tagline para uma superfície de catálogo.
 *
 * Ordem de fallback:
 *  1. localização no `catalogLanguage` pedido;
 *  2. outro idioma suportado (`pt-BR` ↔ `en-US`);
 *  3. idioma declarado pelo legado `overviewLanguage`, quando existir;
 *  4. primeiro bloco localizado com algum texto;
 *  5. campos legados do título (`title`, `overview`, `tagline`).
 *
 * A função nunca traduz conteúdo. Ela apenas escolhe entre textos recebidos das
 * fontes e campos legados ainda mantidos durante a migração.
 */
export function resolveCatalogLocalization(
  subject: CatalogLocalizationSubject,
  catalogLanguage: string | null | undefined,
): ResolvedCatalogLocalization {
  const requestedLanguage = normalizeCatalogLanguageStrict(catalogLanguage);
  const fallbackLanguage: CatalogLanguage = requestedLanguage === "pt-BR" ? "en-US" : "pt-BR";
  const legacyText: LocalizedCatalogText = {
    title: compactText(subject.title) ?? compactText(subject.originalTitle),
    overview: compactText(subject.overview),
    tagline: compactText(subject.tagline),
  };
  const localized = localizedFromSubject(subject);

  const requested = localized[requestedLanguage];
  if (hasLocalizedText(requested)) {
    return {
      ...mergeText(requested as LocalizedCatalogText, legacyText),
      language: requestedLanguage,
      requestedLanguage,
      fallbackUsed: false,
      fallbackLanguage: null,
    };
  }

  const fallback = localized[fallbackLanguage];
  if (hasLocalizedText(fallback)) {
    return {
      ...mergeText(fallback as LocalizedCatalogText, legacyText),
      language: fallbackLanguage,
      requestedLanguage,
      fallbackUsed: true,
      fallbackLanguage,
    };
  }

  const legacyLanguage = subject.overviewLanguage
    ? normalizeCatalogLanguageStrict(subject.overviewLanguage)
    : null;
  const legacyLocalized = legacyLanguage ? localized[legacyLanguage] : null;
  if (legacyLanguage && hasLocalizedText(legacyLocalized)) {
    return {
      ...mergeText(legacyLocalized as LocalizedCatalogText, legacyText),
      language: legacyLanguage,
      requestedLanguage,
      fallbackUsed: legacyLanguage !== requestedLanguage,
      fallbackLanguage: legacyLanguage !== requestedLanguage ? legacyLanguage : null,
    };
  }

  for (const language of CATALOG_LANGUAGES) {
    const text = localized[language];
    if (hasLocalizedText(text)) {
      return {
        ...mergeText(text as LocalizedCatalogText, legacyText),
        language,
        requestedLanguage,
        fallbackUsed: language !== requestedLanguage,
        fallbackLanguage: language !== requestedLanguage ? language : null,
      };
    }
  }

  return {
    ...legacyText,
    language: requestedLanguage,
    requestedLanguage,
    fallbackUsed: false,
    fallbackLanguage: null,
  };
}

/**
 * Ordena `title`/`originalTitle` conforme o idioma de catálogo, para fontes que
 * NÃO têm `localized` bilíngue (apenas título exibível + original). Reutilizável
 * por qualquer superfície (For You, Watchlist, Biblioteca, etc.).
 *
 * - `en-US` → o título ORIGINAL (geralmente inglês) vira o primário; o exibível
 *   (frequentemente pt-BR no banco) vira secundário.
 * - `pt-BR` → mantém o exibível como primário (tradução quando houver).
 *
 * Devolve `{ primary, secondary }` para passar a `resolveDisplayTitle` sem perder
 * a sanitização de IDs técnicos.
 */
export function orderCatalogTitlesByLanguage(input: {
  title?: string | null;
  originalTitle?: string | null;
  language: string | null | undefined;
}): { primary: string | null; secondary: string | null } {
  const lang = normalizeCatalogLanguageStrict(input.language);
  const title = input.title?.trim() ? input.title : null;
  const original = input.originalTitle?.trim() ? input.originalTitle : null;

  if (lang === "en-US") {
    // Prefere o original; o exibível (tradução) vira secundário.
    return original ? { primary: original, secondary: title } : { primary: title, secondary: null };
  }
  // pt-BR: prefere o exibível (tradução); o original vira secundário.
  return title ? { primary: title, secondary: original } : { primary: original, secondary: null };
}

/** Estatística de cobertura de idioma de um conjunto de itens localizados. */
export type CatalogLanguageStats = {
  requestedLanguage: CatalogLanguage;
  resolvedLanguage: CatalogLanguage;
  total: number;
  hasPtBrData: number;
  hasEnUsData: number;
  usedFallbackLanguage: number;
  /** Itens sem dado no idioma pedido (precisaram de fallback ou ficaram vazios). */
  incompleteInRequested: number;
};

export function computeCatalogLanguageStats(
  items: Array<Partial<CatalogLocalized> | null | undefined>,
  requestedLanguage: string | null | undefined,
): CatalogLanguageStats {
  const requested = normalizeCatalogLanguageStrict(requestedLanguage);
  let hasPtBrData = 0;
  let hasEnUsData = 0;
  let usedFallbackLanguage = 0;
  let incompleteInRequested = 0;

  for (const localized of items) {
    if (hasLocalizedText(localized?.["pt-BR"])) hasPtBrData++;
    if (hasLocalizedText(localized?.["en-US"])) hasEnUsData++;
    const picked = pickLocalized(localized, requested);
    if (picked.usedFallback) usedFallbackLanguage++;
    if (!hasLocalizedText(localized?.[requested])) incompleteInRequested++;
  }

  return {
    requestedLanguage: requested,
    resolvedLanguage: requested,
    total: items.length,
    hasPtBrData,
    hasEnUsData,
    usedFallbackLanguage,
    incompleteInRequested,
  };
}

import { db } from "@/server/db/client";
import {
  CATALOG_LANGUAGES,
  normalizeCatalogLanguageStrict,
  type CatalogLanguage,
  type CatalogLocalizationEntry,
} from "@/lib/i18n/catalog-localization";

export type CatalogLocalizationUpsertInput = {
  poplogId: string | number;
  language: string;
  title?: string | null;
  overview?: string | null;
  tagline?: string | null;
  source?: string | null;
  hydratedAt?: Date | null;
};

function clean(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function hasText(input: CatalogLocalizationUpsertInput): boolean {
  return Boolean(clean(input.title) || clean(input.overview) || clean(input.tagline));
}

export async function getCatalogLocalizationsByPoplogId(
  poplogId: string | number | null | undefined,
): Promise<CatalogLocalizationEntry[]> {
  if (poplogId == null) return [];
  const rows = await db.catalogLocalization.findMany({
    where: { poplogId: String(poplogId) },
    orderBy: [{ language: "asc" }, { updatedAt: "desc" }],
  });

  return rows.map((row) => ({
    language: row.language,
    title: row.title,
    overview: row.overview,
    tagline: row.tagline,
    source: row.source,
    hydratedAt: row.hydratedAt,
  }));
}

export async function upsertCatalogLocalization(
  input: CatalogLocalizationUpsertInput,
) {
  if (!hasText(input)) return null;
  const poplogId = String(input.poplogId);
  const language = normalizeCatalogLanguageStrict(input.language);
  const hydratedAt = input.hydratedAt ?? new Date();
  const data = {
    title: clean(input.title),
    overview: clean(input.overview),
    tagline: clean(input.tagline),
    source: clean(input.source),
    hydratedAt,
  };

  return db.catalogLocalization.upsert({
    where: { poplogId_language: { poplogId, language } },
    create: { poplogId, language, ...data },
    update: data,
  });
}

export async function upsertCatalogLocalizations(
  inputs: CatalogLocalizationUpsertInput[],
) {
  const supported = new Set<CatalogLanguage>(CATALOG_LANGUAGES);
  const deduped = new Map<string, CatalogLocalizationUpsertInput>();

  for (const input of inputs) {
    const language = normalizeCatalogLanguageStrict(input.language);
    if (!supported.has(language) || !hasText(input)) continue;
    deduped.set(`${String(input.poplogId)}:${language}`, { ...input, language });
  }

  await Promise.all([...deduped.values()].map((input) => upsertCatalogLocalization(input)));
}

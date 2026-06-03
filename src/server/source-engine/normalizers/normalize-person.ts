import type { CatalogPeople, CatalogPersonEntry } from "../types/catalog.types";
import type { SourceMeta } from "../types/source.types";

export function normalizePeople(
  cast: CatalogPersonEntry[],
  crew: CatalogPersonEntry[],
  meta: SourceMeta,
): CatalogPeople {
  return {
    cast,
    crew,
    source: { ...meta, fetchedAt: meta.fetchedAt ?? new Date().toISOString() },
  };
}

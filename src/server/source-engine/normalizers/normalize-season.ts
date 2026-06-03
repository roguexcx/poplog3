import type { CatalogIds, CatalogSeason } from "../types/catalog.types";
import type { SourceMeta } from "../types/source.types";

type NormalizeSeasonInput = {
  ids: CatalogIds;
  number: number;
  title?: string;
  posterRemoteUrl?: string;
};

export function normalizeSeason(input: NormalizeSeasonInput, meta: SourceMeta): CatalogSeason {
  return {
    ids: input.ids,
    number: input.number,
    title: input.title,
    posterPath: input.posterRemoteUrl,
    source: { ...meta, fetchedAt: meta.fetchedAt ?? new Date().toISOString() },
  };
}

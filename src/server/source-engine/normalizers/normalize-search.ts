import type { CatalogIds, CatalogSearchResult } from "../types/catalog.types";
import type { SourceMeta } from "../types/source.types";

type NormalizeSearchInput = {
  ids: CatalogIds;
  mediaType: "movie" | "show";
  title?: string | null;
  year?: number | null;
  overview?: string | null;
  posterRemoteUrl?: string | null;
};

export function normalizeSearchResult(input: NormalizeSearchInput, meta: SourceMeta): CatalogSearchResult {
  return {
    ids: input.ids,
    mediaType: input.mediaType,
    title: input.title ?? "",
    year: input.year ?? undefined,
    overview: input.overview ?? undefined,
    posterPath: input.posterRemoteUrl ?? undefined,
    source: { ...meta, fetchedAt: meta.fetchedAt ?? new Date().toISOString() },
  };
}

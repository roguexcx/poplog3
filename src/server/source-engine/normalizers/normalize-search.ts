import type { CatalogIds, CatalogSearchResult } from "../types/catalog.types";
import type { SourceMeta } from "../types/source.types";

type NormalizeSearchInput = {
  ids: CatalogIds;
  mediaType: "movie" | "show";
  title?: string | null;
  originalTitle?: string | null;
  year?: number | null;
  releaseDate?: string | null;
  firstAirDate?: string | null;
  overview?: string | null;
  posterRemoteUrl?: string | null;
  backdropRemoteUrl?: string | null;
  genres?: string[] | null;
  genreIds?: number[] | null;
  voteAverage?: number | null;
  voteCount?: number | null;
};

export function normalizeSearchResult(input: NormalizeSearchInput, meta: SourceMeta): CatalogSearchResult {
  return {
    ids: input.ids,
    mediaType: input.mediaType,
    title: input.title ?? "",
    originalTitle: input.originalTitle ?? undefined,
    year: input.year ?? undefined,
    releaseDate: input.releaseDate ?? undefined,
    firstAirDate: input.firstAirDate ?? undefined,
    overview: input.overview ?? undefined,
    posterPath: input.posterRemoteUrl ?? undefined,
    backdropPath: input.backdropRemoteUrl ?? null,
    genres: input.genres ?? undefined,
    genreIds: input.genreIds ?? undefined,
    voteAverage: input.voteAverage ?? undefined,
    voteCount: input.voteCount ?? undefined,
    source: { ...meta, fetchedAt: meta.fetchedAt ?? new Date().toISOString() },
  };
}

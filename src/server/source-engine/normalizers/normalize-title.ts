import type { CatalogIds, CatalogTitle } from "../types/catalog.types";
import type { SourceMeta } from "../types/source.types";

type NormalizeTitleInput = {
  ids: CatalogIds;
  mediaType: "movie" | "show";
  title?: string | null;
  year?: number | null;
  overview?: string | null;
  tagline?: string | null;
  runtime?: number | null;
  status?: string | null;
  genres?: string[] | null;
  country?: string | null;
  language?: string | null;
  certification?: string | null;
  rating?: number | null;
  votes?: number | null;
  posterRemoteUrl?: string | null;
  backdropRemoteUrl?: string | null;
  numberOfSeasons?: number | null;
  numberOfEpisodes?: number | null;
};

export function normalizeTitle(input: NormalizeTitleInput, meta: SourceMeta): CatalogTitle {
  return {
    ids: input.ids,
    mediaType: input.mediaType,
    title: input.title ?? "",
    year: input.year ?? undefined,
    overview: input.overview ?? undefined,
    tagline: input.tagline ?? undefined,
    runtime: input.runtime ?? undefined,
    status: input.status ?? undefined,
    genres: input.genres ?? undefined,
    country: input.country ?? undefined,
    language: input.language ?? undefined,
    certification: input.certification ?? undefined,
    rating: input.rating ?? undefined,
    votes: input.votes ?? undefined,
    posterPath: input.posterRemoteUrl ?? undefined,
    backdropPath: input.backdropRemoteUrl ?? undefined,
    numberOfSeasons: input.numberOfSeasons ?? undefined,
    numberOfEpisodes: input.numberOfEpisodes ?? undefined,
    source: { ...meta, fetchedAt: meta.fetchedAt ?? new Date().toISOString() },
  };
}

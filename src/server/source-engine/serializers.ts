import { resolveDisplayTitle } from "@/lib/titles/display-title";
import { resolveAssetUrl } from "./asset-urls";

type SerializableTitle = {
  tmdb_id?: number | null;
  media_type?: "movie" | "tv" | null;
  title?: string | null;
  original_title?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  year?: number | string | null;
  vote_average?: number | null;
  poplogId?: string | number | null;
  imdb_id?: string | null;
  externalIds?: {
    imdbId?: string | null;
    slug?: string | null;
  };
};

export function serializeTitleCard(title: SerializableTitle) {
  const imdbId = title.externalIds?.imdbId ?? title.imdb_id ?? null;
  const mediaType = title.media_type ?? "movie";
  return {
    id: title.tmdb_id ?? null,
    poplogId: title.poplogId ?? null,
    imdbId,
    mediaType,
    title: resolveDisplayTitle({
      title: title.title,
      originalTitle: title.original_title,
      tmdbId: title.tmdb_id ?? undefined,
      imdbId,
      poplogId: title.poplogId,
      mediaType,
    }),
    originalTitle: title.original_title ?? null,
    year: title.year ?? null,
    posterUrl: resolveAssetUrl(title.poster_path) ?? title.poster_path ?? null,
    backdropUrl: resolveAssetUrl(title.backdrop_path) ?? title.backdrop_path ?? null,
    rating: title.vote_average ?? null,
  };
}

export function serializeTitleDetail(title: SerializableTitle) {
  return {
    ...serializeTitleCard(title),
    overview: title.overview ?? null,
  };
}

export const serializeHomeFeedItem = serializeTitleCard;
export const serializeLibraryItem = serializeTitleCard;
export const serializeRecommendationItem = serializeTitleCard;
export const serializeAdminTitleDetail = serializeTitleDetail;

import type { PoplogTitle } from "../types/title";
import type { TmdbTitleSummary } from "../api-clients/tmdb/types";

export function normalizeTmdbTitle(
  item: TmdbTitleSummary,
): PoplogTitle {
  const isTv =
    item.media_type === "tv" ||
    (!item.media_type &&
      (!!item.name || !!item.first_air_date));

  const releaseDate =
    item.release_date || item.first_air_date;

  return {
    tmdb_id: item.id,

    media_type: isTv ? "tv" : "movie",

    title:
      item.title ||
      item.name ||
      "Untitled",

    original_title:
      item.original_title ||
      item.original_name,

    overview: item.overview,

    poster_path:
      item.poster_path ?? null,

    backdrop_path:
      item.backdrop_path ?? null,

    release_date:
      !isTv
        ? item.release_date ?? null
        : null,

    first_air_date:
      isTv
        ? item.first_air_date ?? null
        : null,

    last_air_date:
      isTv
        ? item.last_air_date ?? null
        : null,

    runtime:
      !isTv
        ? item.runtime ?? null
        : null,

    episode_run_time:
      isTv
        ? item.episode_run_time ?? null
        : null,

    year: releaseDate
      ? Number(releaseDate.slice(0, 4))
      : undefined,

    genres: item.genre_ids,

    popularity: item.popularity,
    vote_average: item.vote_average,
    vote_count: item.vote_count,

    original_language:
      item.original_language,
  };
}
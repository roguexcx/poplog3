import type { OmdbTitleResponse } from "../api-clients/omdb/types";
import type { PoplogRatings } from "../types/ratings";

function parseNumber(value?: string | null) {
  if (!value || value === "N/A") return undefined;

  const cleaned = value
    .replace(/,/g, "")
    .replace("%", "")
    .trim();

  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeOmdbRatings(
  item: OmdbTitleResponse
): PoplogRatings {
  const rottenTomatoes = item.Ratings?.find(
    (rating) => rating.Source === "Rotten Tomatoes"
  );

  const metacriticFromRatings = item.Ratings?.find(
    (rating) => rating.Source === "Metacritic"
  );

  return {
    imdb_rating: parseNumber(item.imdbRating),
    imdb_votes: parseNumber(item.imdbVotes),

    rotten_tomatoes_score: parseNumber(
      rottenTomatoes?.Value
    ),

    metacritic_score:
      parseNumber(item.Metascore) ??
      parseNumber(metacriticFromRatings?.Value),
  };
}
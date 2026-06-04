import type { TMDBImagesResponse } from "@/types/tmdb";

export async function fetchTitleImages(
  _mediaType: "movie" | "tv",
  _id: number,
): Promise<TMDBImagesResponse> {
  return {};
}

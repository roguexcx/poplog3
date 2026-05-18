import { tmdbFetch } from "@/lib/tmdb";
import type { TMDBImagesResponse } from "@/types/tmdb";
import { IMAGES_CACHE_SECONDS } from "./config";

export async function fetchTitleImages(
  mediaType: "movie" | "tv",
  id: number,
): Promise<TMDBImagesResponse> {
  try {
    return await tmdbFetch<TMDBImagesResponse>(
      `/${mediaType}/${id}/images`,
      { include_image_language: "en,pt,null" },
      IMAGES_CACHE_SECONDS,
      null,
    );
  } catch {
    return {};
  }
}

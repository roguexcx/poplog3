import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import type { TMDBImagesResponse } from "@/types/tmdb";
import { IMAGES_CACHE_SECONDS } from "./config";

export async function fetchTitleImages(
  mediaType: "movie" | "tv",
  id: number,
): Promise<TMDBImagesResponse> {
  try {
    return await tmdbFetch<TMDBImagesResponse>(
      `/${mediaType}/${id}/images`,
      { params: { include_image_language: "en,pt,null" }, revalidate: IMAGES_CACHE_SECONDS },
    );
  } catch {
    return {};
  }
}

// src/lib/images/fetch.ts

import { tmdbFetch } from "@/lib/tmdb";
import type { TMDBImagesResponse } from "@/types/tmdb";
import { IMAGES_CACHE_SECONDS } from "./config";

/**
 * Busca o endpoint `/{movie|tv}/{id}/images` do TMDB, com cache de 24h.
 *
 * Importante: `language` é passado como `null` para o tmdbFetch porque
 * queremos *todas* as imagens, não só as do idioma padrão. O filtro
 * por idioma acontece em `pickRandomImage`. `include_image_language`
 * pede ao TMDB para retornar imagens em inglês, português e sem idioma.
 *
 * Retorna `{}` em caso de falha — chamadores devem tratar pools vazios
 * em vez de tentar diferenciar "sem imagens" de "API caiu".
 */
export async function fetchTitleImages(
  mediaType: "movie" | "tv",
  id: number,
): Promise<TMDBImagesResponse> {
  try {
    return await tmdbFetch<TMDBImagesResponse>(
      `/${mediaType}/${id}/images`,
      { include_image_language: "en,pt,null" },
      IMAGES_CACHE_SECONDS,
      null, // ver comentário acima
    );
  } catch {
    return {};
  }
}

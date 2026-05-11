// src/lib/images/index.ts
//
// Barrel central do sistema de imagens do POPLOG.
// Use este módulo (e nunca image.tmdb.org direto) para qualquer URL
// de imagem que o site exiba. Veja `./sizes.ts` para a tabela de
// tamanhos semânticos por contexto, e `./config.ts` para o toggle
// global de randomização.

export {
  IMAGE_SIZES,
  KIND_TO_POOL,
  type ImageKind,
  type ImageSizeOf,
} from "./sizes";

export { buildTmdbUrl, buildTmdbUrlLoose } from "./url";

export { fetchTitleImages } from "./fetch";

export {
  pickRandomImage,
  getRandomTitleImagePath,
  getRandomTitleImages,
} from "./random";

export {
  RANDOMIZATION_ENABLED,
  RANDOMIZATION_LANGUAGES,
  POSTER_RANDOMIZATION_LANGUAGES,
  LOCALIZED_POSTER_RANDOMIZATION_LANGUAGES,
  BACKDROP_RANDOMIZATION_LANGUAGES,
  IMAGES_CACHE_SECONDS,
} from "./config";

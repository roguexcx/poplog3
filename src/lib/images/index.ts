export {
  IMAGE_SIZES,
  KIND_TO_POOL,
  type ImageKind,
  type ImageSizeOf,
} from "./sizes";

export { buildTmdbUrl, buildTmdbUrlLoose } from "./url";

/** Helper canônico para resolver qualquer campo de imagem. Seguro para server + client. */
export { resolveCatalogImage, resolveCatalogImageUrl, type CatalogImageSize } from "./resolve";

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

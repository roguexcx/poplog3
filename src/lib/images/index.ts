export {
  IMAGE_SIZES,
  KIND_TO_POOL,
  type ImageKind,
  type ImageSizeOf,
} from "./sizes";

export { buildTmdbUrlLoose, buildTmdbRawUrl } from "./url";

/** Helper canônico para resolver qualquer campo de imagem. Seguro para server + client. */
export { resolveCatalogImage, resolveCatalogImageUrl, type CatalogImageSize } from "./resolve";

/** Resolver para componentes React — envolve CDNs externos no proxy do POPLOG. */
export { resolveForRender, toProxyUrl, isKnownExternalImageUrl, EXTERNAL_IMAGE_DOMAINS } from "./proxy";

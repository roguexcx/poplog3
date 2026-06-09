/**
 * proxy.ts — Camada de proxy canônica para imagens externas.
 *
 * Todas as imagens de CDNs externos (Trakt, TVDB, TMDB, Amazon, etc.) devem
 * passar por /api/images/proxy antes de chegar ao <img> do cliente. Isso:
 *  - Evita hotlinking direto a CDNs de terceiros (ex: Trakt proíbe explicitamente)
 *  - Isola o frontend de mudanças de domínio ou quebras de CDN externo
 *  - Centraliza cache, headers e políticas de imagem em um único ponto
 *
 * REGRA: use resolveForRender() em componentes React.
 *        use resolveCatalogImage() apenas em código de servidor/DB (não renderiza).
 */

import { resolveCatalogImage, type CatalogImageSize } from "./resolve";

/** Domínios externos autorizados para proxy de imagens. */
export const EXTERNAL_IMAGE_DOMAINS = [
  "image.tmdb.org",
  "m.media-amazon.com",
  "walter-r2.trakt.tv",
  "media.trakt.tv",
  "artworks.thetvdb.com",
  "lh3.googleusercontent.com",
  "img.youtube.com",
  // Adicionar novos domínios aqui — nunca expor diretamente no <img>
] as const satisfies readonly string[];

export type ExternalImageDomain = (typeof EXTERNAL_IMAGE_DOMAINS)[number];

/** Retorna true se a URL pertence a um CDN externo conhecido. */
export function isKnownExternalImageUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return EXTERNAL_IMAGE_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`),
    );
  } catch {
    return false;
  }
}

/**
 * Retorna a URL de proxy do POPLOG para uma imagem externa.
 * Não valida o domínio — use isKnownExternalImageUrl() antes se necessário.
 */
export function toProxyUrl(externalUrl: string): string {
  return `/api/images/proxy?url=${encodeURIComponent(externalUrl)}`;
}

/**
 * Resolve qualquer campo de imagem para uma URL segura para renderização no <img>.
 *
 * Diferente de resolveCatalogImage(), esta função envolve CDNs externos no proxy
 * do POPLOG para evitar hotlinking e dependência direta de serviços externos.
 *
 * Use esta função em TODOS os componentes React que renderizam imagens.
 * Use resolveCatalogImage() apenas em código de servidor/normalizers para armazenamento em DB.
 *
 * @param src  - URL externa, path TMDB legado, null ou undefined.
 * @param size - Tamanho para paths TMDB legados (ex: "w500"). Default: "w500".
 */
export function resolveForRender(
  src: string | null | undefined,
  size: CatalogImageSize | string = "w500",
): string | null {
  const resolved = resolveCatalogImage(src, size);
  if (!resolved) return null;

  // URLs próprias do POPLOG ou data URIs — não proxiar
  if (
    resolved.startsWith("/") ||
    resolved.startsWith("blob:") ||
    resolved.startsWith("data:")
  ) {
    return resolved;
  }

  // CDNs externos conhecidos — rotear pelo proxy
  if (isKnownExternalImageUrl(resolved)) {
    return toProxyUrl(resolved);
  }

  // URLs externas desconhecidas — também proxiar por segurança
  if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
    return toProxyUrl(resolved);
  }

  return resolved;
}

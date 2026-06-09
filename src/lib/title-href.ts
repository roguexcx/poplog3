import type { PoplogMediaType } from "@/types/poplog-card";

type TitleHrefInput = {
  poplogId?: string | number | null;
  mediaType: PoplogMediaType;
  externalIds?: {
    imdbId?: string | null;
    slug?: string | null;
    traktId?: string | number | null;
    tmdbId?: number | null;
  };
};

/**
 * Constrói o href canônico para a página de um título.
 *
 * Prioridade de identificador na URL:
 *   1. poplogId (CUID — identidade canônica local)
 *   2. imdbId (alias amigável e estável — tt...)
 *   3. slug (alias legível — "breaking-bad")
 *   4. traktId (numérico externo)
 *   5. tmdbId (alias numérico externo)
 *
 * URLs baseadas em alias (2–5) serão redirecionadas 308 para a URL canônica
 * pelo roteador de título quando o poplogId for resolvido.
 */
export function buildTitleHref(input: TitleHrefInput): string {
  const { poplogId, mediaType, externalIds } = input;

  const id =
    (poplogId != null ? String(poplogId) : null) ??
    externalIds?.imdbId ??
    externalIds?.slug ??
    (externalIds?.traktId != null ? String(externalIds.traktId) : null) ??
    (externalIds?.tmdbId != null ? String(externalIds.tmdbId) : null);

  if (!id) return `/title/${mediaType}/`;
  return `/title/${mediaType}/${id}`;
}

/**
 * Retorna true se o `id` parece ser um poplogId canônico (CUID v1/v2).
 * Usado para decidir se um redirect 308 é necessário.
 */
export function isCanonicalPoplogId(id: string): boolean {
  // CUID v1: começa com "c", 25 chars, alfanumérico minúsculo
  // CUID v2: começa com qualquer letra minúscula, ~24 chars
  return /^[a-z][a-z0-9]{20,30}$/.test(id);
}

import type { PoplogMediaType } from "@/types/poplog-card";
import { publicTitlePathFromSlug } from "@/server/titles/title-public-routes";

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
 * Prioridade:
 *   1. slug legível ("barbarian-2022") -> "/barbarian-2022"  (link direto, sem redirect)
 *   2. imdbId  -> /title/{mediaType}/tt...
 *   3. poplogId (CUID) -> /title/{mediaType}/{cuid}
 *   4. traktId / tmdbId -> /title/{mediaType}/{id}
 *
 * Regra: nunca gerar /title/... quando houver slug válido disponível.
 */
export function buildTitleHref(input: TitleHrefInput): string {
  const { poplogId, mediaType, externalIds } = input;

  // Slug é o formato público preferido — link direto sem redirect.
  const slugPath = publicTitlePathFromSlug(externalIds?.slug);
  if (slugPath) return slugPath;

  // Fallback para URL legada /title/mediaType/id
  const id =
    externalIds?.imdbId ??
    (poplogId != null ? String(poplogId) : null) ??
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

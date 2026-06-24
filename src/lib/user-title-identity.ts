import type { MediaType, UserTitle } from "@/types/user";
import {
  imdbIdFromSyntheticTmdbId,
  isSyntheticTmdbId,
} from "@/lib/ids/synthetic-tmdb-id";

export type TitleIdentityInput = {
  tmdbId?: number | null;
  poplogId?: string | number | null;
  imdbId?: string | null;
  traktId?: string | number | bigint | null;
  slug?: string | null;
  mediaType: MediaType;
};

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed !== 0 ? parsed : null;
}

/**
 * Gera as chaves de identidade canonicas de um titulo.
 *
 * REGRA DE ESCOPO (critica para a exclusao da biblioteca):
 *
 *   - IMDb, Trakt, slug e Poplog sao identificadores GLOBALMENTE UNICOS: um mesmo
 *     tt.../trakt-id/slug/cuid jamais se refere a um filme E a uma serie diferentes.
 *     Por isso suas chaves NAO levam o tipo de midia: usam o prefixo "g:" (global).
 *
 *   - Apenas o TMDB compartilha o mesmo espaco numerico entre filme e serie
 *     (tmdb 550 = filme; tmdb 550 = uma serie totalmente distinta), entao a chave
 *     TMDB CONTINUA com escopo `${mediaType}:tmdb:...`.
 *
 * Motivacao: candidatos de recomendacao frequentemente chegam com o mediaType
 * ERRADO (herdado da semente). Se a chave IMDb levasse o tipo, um titulo ja na
 * biblioteca recomendado com o tipo trocado escaparia do filtro. Tornando IMDb/
 * Trakt/slug/Poplog globais, o match acontece pelo ID real, imune ao bug de tipo.
 */
export function titleIdentityKeys(input: TitleIdentityInput): string[] {
  const keys = new Set<string>();
  const mediaType = input.mediaType;
  const poplogId = stringOrNull(input.poplogId);
  const imdbId = stringOrNull(input.imdbId);
  const traktId = stringOrNull(input.traktId);
  const slug = stringOrNull(input.slug);
  const tmdbId = numberOrNull(input.tmdbId);

  // Identificadores globalmente unicos -> agnosticos a tipo de midia (prefixo "g:").
  if (poplogId) keys.add(`g:poplog:${poplogId.toLowerCase()}`);
  if (imdbId) keys.add(`g:imdb:${imdbId.toLowerCase()}`);
  if (traktId) keys.add(`g:trakt:${traktId.toLowerCase()}`);
  if (slug) keys.add(`g:slug:${slug.toLowerCase()}`);

  // TMDB compartilha namespace entre filme/serie -> mantem escopo de tipo.
  if (tmdbId) keys.add(`${mediaType}:tmdb:${tmdbId}`);

  // tmdbId sintetico carrega um IMDb embutido -> tambem vira chave IMDb global.
  if (tmdbId && isSyntheticTmdbId(tmdbId)) {
    const syntheticImdbId = imdbIdFromSyntheticTmdbId(tmdbId);
    if (syntheticImdbId) keys.add(`g:imdb:${syntheticImdbId.toLowerCase()}`);
  }

  return Array.from(keys);
}

export function userTitleIdentityKeys(title: UserTitle): string[] {
  return titleIdentityKeys({
    mediaType: title.media_type,
    tmdbId: title.externalIds?.tmdbId ?? title.tmdb_id,
    poplogId: title.poplogId,
    imdbId: title.externalIds?.imdbId ?? title.imdb_id,
    traktId: title.externalIds?.traktId,
    slug: title.externalIds?.slug,
  });
}

export function findUserTitleByIdentity(
  titles: UserTitle[],
  input: TitleIdentityInput,
): UserTitle | undefined {
  const wanted = new Set(titleIdentityKeys(input));
  if (wanted.size === 0) return undefined;

  return titles.find((title) =>
    userTitleIdentityKeys(title).some((key) => wanted.has(key)),
  );
}

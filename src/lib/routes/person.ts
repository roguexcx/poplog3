/**
 * Helper canônico para links de pessoa/artista no POPLOG.
 *
 * Rota oficial: /person/[id]
 *
 * Prioridade de identificador (alinhada ao que a camada getPersonPageData +
 * cache local conseguem resolver hoje):
 *   1. imdbId quando começa com "nm" (melhor ID — Balloonerismm resolve bem)
 *   2. id quando é um token de ID confiável (nm.../tt.../numérico) — nunca um nome
 *   3. slug (alias legível "tom-hanks")
 *   4. traktId
 *   5. tmdbId
 *
 * Retorna `null` quando não há ID confiável — o chamador NÃO deve renderizar
 * um <Link> nesse caso (evita links quebrados como /person/Tom%20Hanks).
 */

const IMDB_PERSON_ID = /^nm\d+$/i;
const IMDB_TITLE_ID = /^tt\d+$/i;
const NUMERIC_ID = /^\d+$/;
const SLUG_LIKE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Aceita apenas IMDb person id (nm...). */
function asImdbPersonId(value: string | number | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return IMDB_PERSON_ID.test(v) ? v : null;
}

/**
 * Token de ID confiável: nm.../tt.../numérico. Rejeita qualquer coisa com
 * espaço ou formato de nome ("Tom Hanks", "Cher") — esses não viram link.
 */
function asIdToken(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  const v = value.trim();
  if (!v || /\s/.test(v)) return null;
  if (IMDB_PERSON_ID.test(v) || IMDB_TITLE_ID.test(v) || NUMERIC_ID.test(v)) return v;
  return null;
}

/** Slug legível ("tom-hanks"). */
function asSlug(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v && SLUG_LIKE.test(v) ? v : null;
}

export function buildPersonHref(input: {
  id?: string | number | null;
  imdbId?: string | null;
  tmdbId?: string | number | null;
  traktId?: string | number | null;
  slug?: string | null;
  name?: string | null;
}): string | null {
  const id =
    asImdbPersonId(input.imdbId) ??
    asImdbPersonId(input.id) ??
    asIdToken(input.id) ??
    asSlug(input.slug) ??
    asIdToken(input.traktId) ??
    asIdToken(input.tmdbId);

  if (!id) return null;
  return `/person/${id}`;
}

/**
 * Resolvedor canônico de título de exibição do POPLOG.
 *
 * Objetivo: NENHUM card, em nenhuma superfície (Biblioteca, Acompanhando,
 * Histórico, Últimos vistos, Watchlist, Home, Busca, Para você, recomendações,
 * detalhes), pode exibir um identificador técnico (`tt...`, `tmdb:...`,
 * `traktId`, `poplogId`, cuid, slug) como nome visível do título.
 *
 * Regra de prioridade (decidida com o produto):
 *   1. título oficial localizado (pt-BR)  → `title` / `name`
 *   2. tradução pt-BR explícita, se houver → `ptBrTitle`
 *   3. título original como fallback       → `originalTitle` / `originalName`
 *   4. placeholder amigável (último caso)  → "Filme sem título" etc.
 *
 * Este módulo é PURO (sem imports de DB/React) para poder ser consumido tanto
 * no servidor (builders de API) quanto no cliente (componentes de card).
 */

export type MediaTypeLike = "movie" | "tv" | string | null | undefined;

/** Identificadores técnicos que nunca devem aparecer como nome visível. */
export type TitleTechnicalIds = {
  imdbId?: string | number | null;
  tmdbId?: string | number | null;
  traktId?: string | number | null;
  tvdbId?: string | number | null;
  poplogId?: string | number | null;
  slug?: string | null;
  linkId?: string | number | null;
};

export type DisplayTitleInput = TitleTechnicalIds & {
  /** Título oficial localizado (pt-BR no POPLOG). */
  title?: string | null;
  /** Campo `name` usado por séries (TMDB tv). */
  name?: string | null;
  /** Tradução pt-BR explícita, quando vem de uma fonte separada. */
  ptBrTitle?: string | null;
  /** Título original (fallback). */
  originalTitle?: string | null;
  /** Campo `original_name` usado por séries. */
  originalName?: string | null;
  /** Snake case aceito para conveniência com payloads de API. */
  original_title?: string | null;
  original_name?: string | null;
  /** Contexto para o placeholder amigável. */
  mediaType?: MediaTypeLike;
  year?: number | null;
};

/** Padrões que identificam, por si só, um ID técnico mascarado de título. */
const IMDB_PATTERN = /^tt\d+$/i;
// Formas explicitamente prefixadas de IDs. Números "crus" (ex.: "1917", "300")
// NÃO são tratados como técnicos por padrão — só caem fora via igualdade com um
// ID conhecido (ver `idCandidates`), preservando títulos numéricos legítimos.
const PREFIXED_ID_PATTERN = /^(tmdb|trakt|imdb|tvdb|poplog|series|movie)\s*[:#\-_]\s*\S+$/i;
const CUID_PATTERN = /^c[a-z0-9]{20,}$/i; // cuid / cuid2 do Prisma (poplogId)
/** Prefixos de placeholder legados que podem anteceder um ID cru. */
const LABEL_PREFIX_PATTERN = /^(t[íi]tulo|s[ée]rie|filme|title|show|movie)\s+/i;

function normalizeString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function idCandidates(ids: TitleTechnicalIds): Set<string> {
  const set = new Set<string>();
  const push = (raw: string | number | null | undefined) => {
    const v = normalizeString(raw);
    if (!v) return;
    set.add(v.toLowerCase());
    // Variantes prefixadas comuns para IDs numéricos.
    set.add(`tmdb:${v}`.toLowerCase());
    set.add(`trakt:${v}`.toLowerCase());
  };
  push(ids.imdbId);
  push(ids.tmdbId);
  push(ids.traktId);
  push(ids.tvdbId);
  push(ids.poplogId);
  push(ids.linkId);
  // NÃO incluímos `slug` por igualdade: o slug é derivado do título. Um slug de
  // palavra única ("fargo") coincide com o título real ("Fargo") e o
  // transformaria em placeholder; e tentar detectar "slug cru" por formato
  // (minúsculas+hífen) rejeitaria títulos legítimos como "9-1-1" ou "Spider-Noir".
  // IDs técnicos reais (tt..., tmdb:..., cuid) já são cobertos pelos padrões acima.
  return set;
}

/**
 * Decide se `value` é (ou contém apenas) um identificador técnico e, portanto,
 * NÃO pode ser usado como título visível.
 */
export function isTechnicalIdLike(
  value: string | null | undefined,
  ids: TitleTechnicalIds = {},
): boolean {
  let candidate = normalizeString(value);
  if (!candidate) return true;

  // Remove um prefixo de rótulo legado ("Título tt123" → "tt123") e reavalia.
  const stripped = candidate.replace(LABEL_PREFIX_PATTERN, "").trim();
  // Só consideramos o "miolo" se ele de fato muda a string (havia prefixo) e o
  // restante é curto/sem espaço — caso contrário é um título real começando com
  // "Filme..."/"Show..." etc.
  if (stripped && stripped !== candidate && !/\s/.test(stripped)) {
    candidate = stripped;
  }

  const lower = candidate.toLowerCase();

  if (IMDB_PATTERN.test(candidate)) return true;
  if (PREFIXED_ID_PATTERN.test(candidate)) return true;
  if (CUID_PATTERN.test(candidate)) return true;

  // Igualdade exata com algum ID conhecido (cobre tmdbId numérico, synthetic
  // negativo, traktId, slug, etc. — sem rejeitar títulos numéricos legítimos
  // como "1917" ou "300", que só caem aqui se forem exatamente o ID daquele item).
  const known = idCandidates(ids);
  if (known.has(lower)) return true;

  // Synthetic tmdbId negativo renderizado como "-10172266".
  if (/^-\d+$/.test(candidate)) return true;

  return false;
}

/** Placeholder amigável de último recurso. */
export function friendlyTitlePlaceholder(mediaType?: MediaTypeLike): string {
  if (mediaType === "movie") return "Filme sem título";
  if (mediaType === "tv") return "Série sem título";
  return "Título sem nome";
}

/**
 * Sanitiza um título já escolhido: devolve `null` se for um ID técnico, ou a
 * string limpa caso contrário. Usado na camada de render como defesa final.
 */
export function sanitizeDisplayTitle(
  value: string | null | undefined,
  ids: TitleTechnicalIds = {},
): string | null {
  const candidate = normalizeString(value);
  if (!candidate) return null;
  if (isTechnicalIdLike(candidate, ids)) return null;
  return candidate;
}

/**
 * Resolvedor canônico. Recebe todos os candidatos + IDs e devolve SEMPRE uma
 * string limpa e segura para exibição.
 */
export function resolveDisplayTitle(input: DisplayTitleInput): string {
  const ids: TitleTechnicalIds = {
    imdbId: input.imdbId,
    tmdbId: input.tmdbId,
    traktId: input.traktId,
    tvdbId: input.tvdbId,
    poplogId: input.poplogId,
    slug: input.slug,
    linkId: input.linkId,
  };

  const ordered: Array<string | null | undefined> = [
    input.title,
    input.name,
    input.ptBrTitle,
    input.originalTitle,
    input.original_title,
    input.originalName,
    input.original_name,
  ];

  for (const candidate of ordered) {
    const clean = sanitizeDisplayTitle(candidate, ids);
    if (clean) return clean;
  }

  return friendlyTitlePlaceholder(input.mediaType);
}

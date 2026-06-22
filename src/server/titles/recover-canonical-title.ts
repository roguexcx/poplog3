/**
 * Recuperação canônica de TÍTULO REAL para linhas cujo `title` está vazio ou
 * guarda um identificador técnico.
 *
 * Diferente do resolvedor visual (`@/lib/titles/display-title`), que apenas
 * impede o vazamento de IDs escolhendo o melhor candidato JÁ disponível, este
 * módulo tenta RECUPERAR o nome real a partir de várias fontes, na ordem:
 *
 *   1. `title` já existente (se não for ID técnico)
 *   2. `name` (payload)
 *   3. `originalTitle`
 *   4. `originalName` (payload)
 *   5. título localizado pt-BR (payload `title`/`name`)
 *   6. outra linha Poplog3Title com mesmo imdbId / tmdbId / traktId / poplogId
 *   7. resolução via aliases/identity (`resolvePoplogTitleIdentity`)
 *   8. re-hidratação na fonte (Trakt/catálogo) por tmdbId real, imdbId ou traktId
 *   9. (só então) `null`
 *
 * Os passos 1–5 são SÍNCRONOS/locais (sem rede) e expostos em
 * `recoverTitleFromRowSync`, seguros para o caminho de request das rotas.
 * Os passos 6–8 fazem I/O (DB extra + rede) e ficam em `recoverCanonicalTitle`,
 * próprios para backfill e hidratação em background.
 */

import { Prisma } from "@prisma/client";

import { db } from "@/server/db/client";
import {
  sanitizeDisplayTitle,
  type MediaTypeLike,
  type TitleTechnicalIds,
} from "@/lib/titles/display-title";
import { imdbIdFromSyntheticTmdbId } from "@/lib/ids/synthetic-tmdb-id";

export type RecoverableTitleRow = {
  id?: string | null;
  tmdbId?: number | null;
  imdbId?: string | null;
  traktId?: bigint | number | string | null;
  slug?: string | null;
  mediaType: "movie" | "tv";
  title?: string | null;
  originalTitle?: string | null;
  /** Colunas JSON onde o payload bruto da fonte costuma guardar o nome real. */
  tmdbPayload?: unknown;
  sourcePayload?: unknown;
};

export type TitleRecoverySource =
  | "existing"
  | "payload"
  | "original"
  | "sibling"
  | "identity"
  | "rehydrate"
  | "none";

export type TitleRecoveryResult = {
  title: string | null;
  source: TitleRecoverySource;
};

function idsFromRow(row: RecoverableTitleRow): TitleTechnicalIds {
  return {
    tmdbId: row.tmdbId ?? null,
    imdbId: row.imdbId ?? null,
    traktId: row.traktId != null ? String(row.traktId) : null,
    poplogId: row.id ?? null,
    slug: row.slug ?? null,
  };
}

/** Lê um conjunto de chaves de um payload JSON (objeto ou string serializada). */
function payloadValue(payload: unknown, keys: string[]): string | null {
  if (!payload) return null;
  let obj: Record<string, unknown> | null = null;
  if (typeof payload === "string") {
    try {
      obj = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof payload === "object") {
    obj = payload as Record<string, unknown>;
  }
  if (!obj) return null;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/**
 * Recuperação LOCAL (sem rede): campos da linha + payloads.
 * Segura para usar no caminho de request.
 */
export function recoverTitleFromRowSync(
  row: RecoverableTitleRow,
): TitleRecoveryResult {
  const ids = idsFromRow(row);

  // 1. title existente já válido.
  const existing = sanitizeDisplayTitle(row.title, ids);
  if (existing) return { title: existing, source: "existing" };

  // 2/5. payloads: localizado (title/name) — pt-BR no POPLOG.
  for (const payload of [row.tmdbPayload, row.sourcePayload]) {
    const localized = sanitizeDisplayTitle(
      payloadValue(payload, ["title", "name"]),
      ids,
    );
    if (localized) return { title: localized, source: "payload" };
  }

  // 3. originalTitle da própria linha.
  const original = sanitizeDisplayTitle(row.originalTitle, ids);
  if (original) return { title: original, source: "original" };

  // 4. original do payload.
  for (const payload of [row.tmdbPayload, row.sourcePayload]) {
    const origPayload = sanitizeDisplayTitle(
      payloadValue(payload, ["originalTitle", "original_title", "originalName", "original_name"]),
      ids,
    );
    if (origPayload) return { title: origPayload, source: "payload" };
  }

  return { title: null, source: "none" };
}

/** Busca o nome real em OUTRA linha que compartilhe um identificador. */
async function recoverFromSibling(
  row: RecoverableTitleRow,
): Promise<string | null> {
  const ids = idsFromRow(row);
  const or: Prisma.Poplog3TitleWhereInput[] = [];
  if (row.imdbId) or.push({ imdbId: row.imdbId });
  if (typeof row.tmdbId === "number" && row.tmdbId > 0) or.push({ tmdbId: row.tmdbId });
  if (row.traktId != null) {
    try {
      or.push({ traktId: BigInt(String(row.traktId)) });
    } catch {
      /* ignora traktId inválido */
    }
  }
  if (or.length === 0) return null;

  const siblings = await db.poplog3Title.findMany({
    where: {
      OR: or,
      mediaType: row.mediaType,
      ...(row.id ? { NOT: { id: row.id } } : {}),
    },
    select: { title: true, originalTitle: true },
    take: 10,
  });

  for (const s of siblings) {
    const clean = sanitizeDisplayTitle(s.title, ids) ?? sanitizeDisplayTitle(s.originalTitle, ids);
    if (clean) return clean;
  }
  return null;
}

/** Deriva o melhor `id` textual para alimentar identity/re-hidratação. */
function bestExternalId(row: RecoverableTitleRow): {
  imdbId: string | null;
  realTmdbId: number | null;
  traktId: number | null;
} {
  const realTmdbId =
    typeof row.tmdbId === "number" && row.tmdbId > 0 ? row.tmdbId : null;
  const syntheticImdb =
    typeof row.tmdbId === "number" && row.tmdbId < 0
      ? imdbIdFromSyntheticTmdbId(row.tmdbId)
      : null;
  const imdbId = row.imdbId ?? syntheticImdb ?? null;
  let traktId: number | null = null;
  if (row.traktId != null) {
    const n = Number(row.traktId);
    if (Number.isFinite(n) && n > 0) traktId = n;
  }
  return { imdbId, realTmdbId, traktId };
}

/** Resolução via aliases/identity. */
async function recoverFromIdentity(
  row: RecoverableTitleRow,
): Promise<string | null> {
  const ids = idsFromRow(row);
  const { imdbId, realTmdbId, traktId } = bestExternalId(row);
  const idStr =
    imdbId ?? (realTmdbId ? String(realTmdbId) : traktId ? String(traktId) : null);
  if (!idStr) return null;
  try {
    const { resolvePoplogTitleIdentity } = await import("./poplog-title-identity");
    const identity = await resolvePoplogTitleIdentity({
      mediaType: row.mediaType,
      id: idStr,
      sourceHint: imdbId && idStr === imdbId ? "imdb" : "auto",
    });
    return sanitizeDisplayTitle(identity.title, ids);
  } catch {
    return null;
  }
}

/**
 * Busca BIDIRECIONAL na fonte: consulta os endpoints de filme E série em
 * paralelo e devolve o que existir, junto do mediaType detectado. Essencial para
 * itens com mediaType errado (ex.: filme salvo como série) — o endpoint de série
 * volta vazio, mas o de filme resolve.
 */
async function fetchCatalogBidirectional(
  row: RecoverableTitleRow,
): Promise<{ title: string | null; originalTitle: string | null; mediaType: "movie" | "tv" } | null> {
  const { imdbId, realTmdbId, traktId } = bestExternalId(row);
  if (!imdbId && !realTmdbId && !traktId) return null;
  try {
    const { catalogGetMovie, catalogGetShow } = await import("@/server/source-engine/engine");
    const params = {
      tmdbId: realTmdbId ?? undefined,
      imdbId: imdbId ?? undefined,
      traktId: traktId ?? undefined,
    };
    const [movie, show] = await Promise.all([
      catalogGetMovie(params).catch(() => null),
      catalogGetShow(params).catch(() => null),
    ]);
    // Preferir o tipo já armazenado quando ambos existirem (remakes, etc.);
    // caso contrário, usar o único que resolveu.
    const pick = (mt: "movie" | "tv") =>
      mt === "tv"
        ? show?.title
          ? { title: show.title, originalTitle: show.originalTitle ?? null, mediaType: "tv" as const }
          : null
        : movie?.title
          ? { title: movie.title, originalTitle: movie.originalTitle ?? null, mediaType: "movie" as const }
          : null;
    if (row.mediaType === "tv") return pick("tv") ?? pick("movie");
    return pick("movie") ?? pick("tv");
  } catch {
    return null;
  }
}

/** Re-hidratação na fonte (Trakt/catálogo). Faz rede. */
async function recoverFromRehydrate(
  row: RecoverableTitleRow,
): Promise<string | null> {
  const ids = idsFromRow(row);
  const catalog = await fetchCatalogBidirectional(row);
  if (!catalog) return null;
  return (
    sanitizeDisplayTitle(catalog.title, ids) ??
    sanitizeDisplayTitle(catalog.originalTitle, ids)
  );
}

/**
 * Resolve o título canônico E o mediaType real (filme vs série) de uma linha.
 * Usado pelo reparo de mediaType: detecta quando um filme está salvo como série.
 */
export async function resolveCanonicalMediaAndTitle(
  row: RecoverableTitleRow,
): Promise<{ title: string | null; mediaType: "movie" | "tv" | null; source: TitleRecoverySource }> {
  // Local primeiro (sem rede) — mantém o mediaType atual.
  const local = recoverTitleFromRowSync(row);
  if (local.title) return { title: local.title, mediaType: row.mediaType, source: local.source };

  const catalog = await fetchCatalogBidirectional(row);
  if (catalog) {
    const ids = idsFromRow(row);
    const title =
      sanitizeDisplayTitle(catalog.title, ids) ??
      sanitizeDisplayTitle(catalog.originalTitle, ids);
    return { title, mediaType: catalog.mediaType, source: "rehydrate" };
  }
  return { title: null, mediaType: null, source: "none" };
}

export type RecoverOptions = {
  /** Tenta re-hidratação na fonte (rede). Default: true. */
  rehydrate?: boolean;
  /** Tenta resolução via identity/aliases (rede). Default: true. */
  useIdentity?: boolean;
};

/**
 * Recuperação CANÔNICA completa (local → sibling → identity → re-hidratação).
 * Use em backfill / hidratação em background.
 */
export async function recoverCanonicalTitle(
  row: RecoverableTitleRow,
  options: RecoverOptions = {},
): Promise<TitleRecoveryResult> {
  const { rehydrate = true, useIdentity = true } = options;

  // 1–5: local (campos + payloads).
  const local = recoverTitleFromRowSync(row);
  if (local.title) return local;

  // 6: linha irmã.
  const sibling = await recoverFromSibling(row);
  if (sibling) return { title: sibling, source: "sibling" };

  // 7: identity/aliases.
  if (useIdentity) {
    const identity = await recoverFromIdentity(row);
    if (identity) return { title: identity, source: "identity" };
  }

  // 8: re-hidratação na fonte.
  if (rehydrate) {
    const rehydrated = await recoverFromRehydrate(row);
    if (rehydrated) return { title: rehydrated, source: "rehydrate" };
  }

  // 9: nada utilizável.
  return { title: null, source: "none" };
}

/** Placeholder amigável para `MediaTypeLike` — reexport conveniente. */
export type { MediaTypeLike };

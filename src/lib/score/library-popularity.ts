/**
 * Resolver canônico de popularidade para a Biblioteca.
 *
 * Problema: `normalizeTmdbPopularity()` usava o campo `popularity` do TMDB como
 * métrica principal, mas o POPLOG não deve mais depender do TMDB como sinal primário.
 *
 * Solução: hierarquia de sinais baseada em Trakt + proxy de engajamento:
 *
 *   1. Score Trakt Index (7 sinais: trending, watched, played, favorited, watchers)
 *      → mesmo score canônico usado em "Em alta", Home e Hero.
 *      → range de saída: [0.5, 1.0] — itens indexados sempre acima dos não-indexados.
 *
 *   2. Proxy de engajamento: vote_average normalizado (ex.: IMDb via Balloonerismm ou TMDB)
 *      → usado quando o título não aparece no índice Trakt (a maioria da biblioteca).
 *      → range de saída: [0, 0.49].
 *
 *   3. TMDB popularity — fallback legado explícito de baixa prioridade.
 *      → ativado apenas quando vote_average também está ausente.
 *      → score multiplicado por 0.3 para nunca competir com sinais Trakt.
 *
 * A ordenação considera apenas os títulos da biblioteca atual do usuário;
 * o TraktScoreMap é pré-calculado no servidor e passado ao componente cliente.
 */

import type { Poplog3UserLibraryItem } from "@/server/library/library-service";
import { normalizeTmdbPopularity } from "./tmdb-popularity";

// ─── Tipos públicos ───────────────────────────────────────────────────────────

/**
 * Mapa pré-calculado de score Trakt por identificador de título.
 *
 * Chaves aceitas:
 *   - IMDb ID literal (ex.: "tt0111161")
 *   - Prefixo tmdb (ex.: "tmdb:550")
 *
 * Construído no servidor a partir do Trakt Index e serializado como
 * `Record<string, number>` para ser passado ao componente cliente.
 */
export type TraktScoreMap = Map<string, number>;

// ─── Normalização do score Trakt ──────────────────────────────────────────────

/**
 * Score Trakt máximo observável dado a fórmula do engine.
 * Estimativa conservadora: um título com rank=1 em todos os 7 sinais de maior peso.
 *   (116 + 120) * 2.20 + (116 + 120) * 1.35 + ... + bonus ≈ 1 800
 * Usamos 2 000 como teto para manter margem e reutilizar o mesmo cap do TMDB.
 */
const TRAKT_SCORE_CAP = 2_000;

/**
 * Normaliza um score Trakt Index (0–∞) para escala 0–1 usando curva log₁₀ com cap.
 * Mantém ordenação relativa entre títulos indexados.
 */
function normalizeTraktScore(score: number): number {
  if (!score || score <= 0) return 0;
  const capped = Math.min(score, TRAKT_SCORE_CAP);
  const normalized = Math.log10(1 + capped) / Math.log10(1 + TRAKT_SCORE_CAP);
  return Math.min(1, Math.max(0, normalized));
}

// ─── Resolver principal ───────────────────────────────────────────────────────

/**
 * Resolve o score de popularidade de um item da biblioteca.
 *
 * @param item        - Item da biblioteca do usuário.
 * @param traktScores - Mapa imdbId/tmdbId → score Trakt Index (construído no servidor).
 * @returns Score em escala [0, 1]. Itens com score Trakt ficam no range [0.5, 1.0];
 *          os demais ficam em [0, 0.49].
 */
export function resolveLibraryPopularityScore(
  item: Poplog3UserLibraryItem,
  traktScores: TraktScoreMap,
): number {
  // ── 1. Score Trakt Index ──────────────────────────────────────────────────
  // Lookup por IMDb ID (mais confiável) ou prefixo tmdb como fallback de identidade.
  const imdbId = item.imdb_id;
  const tmdbKey = `tmdb:${item.tmdb_id}`;

  const traktRaw =
    (imdbId ? traktScores.get(imdbId) : undefined) ??
    traktScores.get(tmdbKey);

  if (traktRaw !== undefined) {
    // Mapeia [0, 1] → [0.5, 1.0] para garantir que itens Trakt fiquem acima dos demais.
    return 0.5 + normalizeTraktScore(traktRaw) * 0.5;
  }

  // ── 2. Proxy de engajamento — vote_average ────────────────────────────────
  // vote_average é o melhor sinal disponível por item sem acesso ao Trakt:
  // pode vir do IMDb via Balloonerismm (quando persistido no cache) ou do TMDB.
  // Escala original: 0–10 → normalizado para [0, 0.49].
  const voteAvg = item.title?.vote_average;
  if (typeof voteAvg === "number" && voteAvg > 0) {
    return (Math.min(10, voteAvg) / 10) * 0.49;
  }

  // ── 3. TMDB popularity — fallback legado, baixa prioridade ───────────────
  // Mantido apenas para não zerar scores de títulos sem nenhum sinal melhor.
  // Penalizado para nunca competir com os sinais acima.
  const tmdbPop = item.title?.popularity;
  if (typeof tmdbPop === "number" && tmdbPop > 0) {
    return normalizeTmdbPopularity(tmdbPop) * 0.3;
  }

  return 0;
}

// ─── Construção do TraktScoreMap (server-side) ────────────────────────────────

/**
 * Constrói um `TraktScoreMap` a partir de um array de itens do Trakt Index.
 *
 * Indexa por IMDb ID (chave principal) e por `tmdb:{tmdbId}` (chave secundária).
 * Deve ser chamado no servidor e o resultado serializado como `Record<string, number>`
 * para ser passado ao componente cliente.
 *
 * @param traktItems - Array de itens do Trakt Index (ex.: resultado de getPoplogDailyTrendingIndex).
 */
export function buildTraktScoreMapFromIndex(
  traktItems: Array<{
    score: number;
    ids: { imdb?: string; tmdb?: number };
    tmdb_id: number;
  }>,
): TraktScoreMap {
  const map: TraktScoreMap = new Map();

  for (const item of traktItems) {
    const { score, ids, tmdb_id } = item;
    if (ids.imdb) map.set(ids.imdb, score);
    const tmdbId = ids.tmdb ?? tmdb_id;
    if (tmdbId) map.set(`tmdb:${tmdbId}`, score);
  }

  return map;
}

/**
 * Converte um `TraktScoreMap` para `Record<string, number>` serializável via JSON
 * (para passagem como prop de server → client component).
 */
export function serializeTraktScoreMap(map: TraktScoreMap): Record<string, number> {
  return Object.fromEntries(map);
}

/**
 * Reconstrói um `TraktScoreMap` a partir do objeto serializado
 * (no cliente, a partir do prop recebido).
 */
export function deserializeTraktScoreMap(record: Record<string, number>): TraktScoreMap {
  return new Map(Object.entries(record));
}

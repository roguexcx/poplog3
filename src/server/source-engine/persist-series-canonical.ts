/**
 * Persistência de metadados canônicos ricos de série.
 *
 * Armazena o resultado da SeriesCanonicalEngine no registro Poplog3Title,
 * atualizando campos nativos (numberOfSeasons, voteAverage, etc.) e preservando
 * o payload canônico completo em tmdbPayload para uso futuro por outras áreas do POPLOG.
 *
 * Regras:
 *   - Não sobrescreve campos que já têm valor com dados de confiança inferior
 *   - tmdbPayload recebe uma chave "canonicalMeta" com o payload completo
 *   - Chamada fire-and-forget — nunca bloqueia o render da página
 */

import { upsertCachedTitleRow } from "@/server/repositories";
import type { SeriesCanonicalMeta } from "./series-canonical-engine";

type MediaType = "movie" | "tv";

/**
 * Persiste os dados canônicos da série no banco.
 * Deve ser chamada de forma fire-and-forget (.catch(() => {})).
 */
export async function persistSeriesCanonicalMeta(
  tmdbId: number,
  mediaType: MediaType,
  canonical: SeriesCanonicalMeta,
): Promise<void> {
  // Payload rico para armazenamento — contém todos os dados que a UI atual
  // ainda não usa mas que outras áreas do POPLOG podem precisar no futuro.
  const canonicalPayload = {
    canonicalMeta: {
      // Metadados ricos não cobertos por colunas nativas
      tagline: canonical.tagline ?? null,
      trailerUrl: canonical.trailerUrl ?? null,
      homepage: canonical.homepage ?? null,
      logo: canonical.logo ?? null,
      imagePool: canonical.imagePool,
      network: canonical.network ?? null,
      networks: canonical.networks,
      companies: canonical.companies,
      availableTranslations: canonical.availableTranslations,
      airedEpisodes: canonical.airedEpisodes ?? null,
      // IDs canônicos cruzados de todas as fontes
      ids: canonical.ids,
      // Meta de merge para debug e auditoria
      sourceCount: canonical.sourceCount,
      mergeConfidence: canonical.mergeConfidence,
      sources: canonical.sources.map((s) => ({
        source: s.source,
        sourceId: s.sourceId,
        confidence: s.confidence,
        ids: s.ids,
      })),
      persistedAt: new Date().toISOString(),
    },
  };

  await upsertCachedTitleRow({
    tmdbId,
    mediaType,
    // Campos nativos — só atualiza quando temos dados melhores
    ...(canonical.overview ? { overview: canonical.overview } : {}),
    ...(canonical.poster ? { posterPath: canonical.poster } : {}),
    ...(canonical.backdrop ? { backdropPath: canonical.backdrop } : {}),
    ...(canonical.year ? { year: canonical.year } : {}),
    ...(canonical.runtime ? { runtime: canonical.runtime } : {}),
    ...(canonical.rating ? { voteAverage: canonical.rating } : {}),
    ...(canonical.votes ? { voteCount: canonical.votes } : {}),
    ...(canonical.numberOfSeasons ? { numberOfSeasons: canonical.numberOfSeasons } : {}),
    ...(canonical.numberOfEpisodes ? { numberOfEpisodes: canonical.numberOfEpisodes } : {}),
    ...(canonical.lastAirDate ? { lastAirDate: canonical.lastAirDate } : {}),
    ...(canonical.language ? { originalLanguage: canonical.language } : {}),
    ...(canonical.genres.length > 0 ? { genres: canonical.genres } : {}),
    // Payload canônico completo no campo tmdbPayload
    tmdbPayload: canonicalPayload,
    lastSyncedAt: new Date(),
  });
}

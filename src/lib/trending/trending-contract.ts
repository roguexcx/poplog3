/**
 * Contrato V2 do Trending / "Em alta agora".
 *
 * Padroniza o payload consumido por Home, Hero, bloco "Em alta agora" e
 * Search/Discovery: idioma, região, fonte, recência, identidade POPLOG e as
 * versões localizadas (pt-BR/en-US) num único formato explícito e tipado.
 *
 * Princípios:
 *  - IMDb-first: `imdbId` é a identidade principal; trakt/tmdb/slug são aliases.
 *  - Multilíngue sem tradução manual: `localized` carrega o que a fonte forneceu.
 *  - Transparência: `source` + `realness` deixam claro se é trending real ou
 *    fallback local (popularidade), nunca apresentando um como o outro.
 */

import type {
  CatalogLanguage,
  CatalogLocalized,
  CatalogLanguageStats,
} from "@/lib/i18n/catalog-localization";
import {
  pickLocalized,
  computeCatalogLanguageStats,
  normalizeCatalogLanguageStrict,
} from "@/lib/i18n/catalog-localization";
import type { PoplogTitle } from "@/server/types/title";
import type { TrendingRecency } from "@/lib/trakt-index/types";

/** Distingue a base servida: termômetro real vs. contingência por popularidade. */
export type TrendingRealness = "trending" | "fallback_local";

export type TrendingV2Source =
  | "cache"
  | "trakt_index"
  | "trakt"
  | "local_db"
  | "unavailable";

export type TrendingV2Item = {
  poplogId: string | number | null;
  imdbId: string | null;
  traktId: number | string | null;
  tmdbId: number | null;
  slug: string | null;
  mediaType: "movie" | "tv";

  /** Título/sinopse/tagline projetados para o idioma pedido (com fallback). */
  title: string;
  overview: string | null;
  originalTitle: string | null;

  /** Versões por idioma preservadas para o cliente decidir/depurar. */
  localized: Partial<CatalogLocalized>;

  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  firstAirDate: string | null;
  year: number | null;

  voteAverage: number | null;
  score: number | null;
  rank: number;
  source: string;

  recency: TrendingRecency | null;

  /** True quando o idioma pedido não tinha dado e caiu para o outro idioma. */
  usedFallbackLanguage: boolean;
};

export type TrendingV2Response = {
  ok: true;
  language: CatalogLanguage;
  region: string;
  /** Fonte técnica da lista. */
  source: TrendingV2Source;
  /** Termômetro real ou contingência local — nunca confundir os dois. */
  realness: TrendingRealness;
  cacheStatus: string;
  generatedAt: string;
  count: number;
  items: TrendingV2Item[];
  languageStats: CatalogLanguageStats;
};

/** Item de entrada: PoplogTitle enriquecido (id + recency + localized). */
export type TrendingSerializableItem = PoplogTitle & {
  id?: number;
  rank?: number;
};

function deriveRealness(source: TrendingV2Source): TrendingRealness {
  return source === "local_db" ? "fallback_local" : "trending";
}

/** Constrói um `TrendingV2Item` projetando o texto para o idioma pedido. */
export function toTrendingV2Item(
  item: TrendingSerializableItem,
  language: string,
  index: number,
): TrendingV2Item {
  const picked = pickLocalized(item.localized, language);
  const tmdbId = item.externalIds?.tmdbId ?? (typeof item.tmdb_id === "number" ? item.tmdb_id : null);
  const traktId = item.externalIds?.traktId ?? null;

  return {
    poplogId: item.poplogId ?? null,
    imdbId: item.externalIds?.imdbId ?? item.imdb_id ?? null,
    traktId: traktId ?? null,
    tmdbId: tmdbId != null && tmdbId > 0 ? tmdbId : (tmdbId ?? null),
    slug: item.externalIds?.slug ?? null,
    mediaType: item.media_type,

    title: picked.text.title ?? item.title ?? "",
    overview: picked.text.overview ?? item.overview ?? null,
    originalTitle: item.original_title ?? null,

    localized: item.localized ?? {},

    posterPath: item.poster_path ?? null,
    backdropPath: item.backdrop_path ?? null,
    releaseDate: item.release_date ?? null,
    firstAirDate: item.first_air_date ?? null,
    year: item.year ?? null,

    voteAverage: item.vote_average ?? null,
    score: item.popularity ?? null,
    rank: item.rank ?? index + 1,
    source: item.normalizedFrom ?? "trending",

    recency: item.recency ?? null,
    usedFallbackLanguage: picked.usedFallback,
  };
}

export function buildTrendingV2Response(input: {
  items: TrendingSerializableItem[];
  language: string;
  region: string;
  source: TrendingV2Source;
  cacheStatus: string;
  generatedAt?: string;
}): TrendingV2Response {
  const language = normalizeCatalogLanguageStrict(input.language);
  const items = input.items.map((item, index) => toTrendingV2Item(item, language, index));
  const languageStats = computeCatalogLanguageStats(
    input.items.map((item) => item.localized ?? null),
    language,
  );

  return {
    ok: true,
    language,
    region: input.region,
    source: input.source,
    realness: deriveRealness(input.source),
    cacheStatus: input.cacheStatus,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    count: items.length,
    items,
    languageStats,
  };
}

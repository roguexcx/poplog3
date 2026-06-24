/**
 * Tipos da camada global de disponibilidade (Onde Assistir).
 *
 * Esta é a forma canônica `availability` consumida por qualquer card/lista/grid
 * do site (Biblioteca, Home, Busca, Trending, Watchlist, Sorteio, Title page…).
 *
 * Regra de ouro: se o site exibe um título, ele recebe um `TitleAvailabilitySummary`
 * normalizado — nenhum componente chama a API externa diretamente.
 */

import type { TitleProvider } from "@/features/title/types";
import type { ProviderDisplayPreference } from "@/server/streaming/provider-normalization";
import type { ReleaseKind } from "./release-status";

export type AvailabilityRegion = string; // "BR" | "US" | …

/** Providers agrupados por tipo de oferta (formato JustWatch/TMDB). */
export type GroupedProviders = {
  flatrate: TitleProvider[];
  rent: TitleProvider[];
  buy: TitleProvider[];
  free: TitleProvider[];
  ads: TitleProvider[];
};

/** Flags de status derivadas — prontas para a UI decidir o que exibir. */
export type AvailabilityStatus = {
  hasStreaming: boolean;
  hasRent: boolean;
  hasBuy: boolean;
  isAvailableSomewhere: boolean;
  isInTheaters: boolean;
  isFutureRelease: boolean;
  isUnavailable: boolean;
};

/** Origem do dado de availability. */
export type AvailabilitySource =
  | "balloonerismm"
  | "local"
  | "cache"
  | "justwatch_graphql_unofficial"
  | "none";

/**
 * Estado de resolução da disponibilidade — separa "não tem provider" de "não consegui checar".
 *   - available      → tem ao menos um provider.
 *   - unavailable    → ID resolvido e o endpoint retornou sem providers (negativo genuíno).
 *   - unresolved     → não foi possível resolver um IMDb ID para consultar.
 *   - provider_error → ID resolvido, mas a chamada falhou (cooldown/429/timeout/inativo).
 *
 * A UI deve esconder o slot de provider apenas em `unavailable`; em `unresolved`/`provider_error`
 * o dado é desconhecido (não significa ausência) e pode ser re-tentado depois.
 */
export type AvailabilityState =
  | "available"
  | "unavailable"
  | "unresolved"
  | "provider_error";

/**
 * Resumo canônico de disponibilidade de um título.
 * Sempre seguro para serializar e enviar a um componente client.
 */
export type TitleAvailabilitySummary = {
  region: AvailabilityRegion;
  providers: GroupedProviders;
  status: AvailabilityStatus;
  /** Estado de resolução — distingue "sem provider" de "não checável". */
  state: AvailabilityState;
  /** Melhor provider para exibição compacta (1 logo) — flatrate > free > ads > rent > buy. */
  bestProvider: TitleProvider | null;
  source: AvailabilitySource;
  /** ISO timestamp de quando o dado foi resolvido/cacheado. */
  checkedAt: string;
  release: {
    kind: ReleaseKind;
    theatricalDate: string | null;
    expectedVodDate: string | null;
    earliestRelevantDate: string | null;
    theatricalWindowEndsAt: string | null;
  };
};

/** Identificadores aceitos pela camada — qualquer um resolve o título. */
export type AvailabilityIdInput = {
  mediaType: "movie" | "tv";
  imdbId?: string | null;
  tmdbId?: number | null;
  traktId?: number | string | null;
  region?: AvailabilityRegion;
  /** Datas para janela de TTL/cinema, quando já conhecidas pelo caller. */
  releaseDate?: string | null;
  firstAirDate?: string | null;
  /**
   * Título e ano, quando conhecidos pelo caller. Opcionais — usados APENAS pelo
   * fallback experimental JustWatch GraphQL (busca por título). Quando ausentes, o
   * fallback tenta resolver o título pelo cache canônico de títulos.
   */
  title?: string | null;
  year?: number | null;
  /**
   * Resolução APENAS por cache persistente — não dispara fetch ao vivo no Balloonerismm.
   * Usado em contextos de LISTA (Home/Watchlist/Biblioteca) para evitar tempestades de
   * chamadas ao vivo que, sob carga + cobertura BR inconsistente da fonte, gravavam
   * negativos falsos. Cache-miss → estado "unresolved" (desconhecido, NUNCA "unavailable").
   */
  cacheOnly?: boolean;
  /** Pula /release_dates no warm background para evitar dobrar chamadas Balloonerismm em lote. */
  skipReleaseDates?: boolean;
  /**
   * Interno: suprime o auto-warm de sentinelas negativas REVALIDÁVEIS encontradas em
   * cacheOnly. Usado pelo hydrateManyTitleAvailability, que já agenda o warm em lote
   * (warmCold) de forma limitada — evita duplicar o aquecimento.
   */
  suppressAutoWarm?: boolean;
  /**
   * Ignora a sentinela negativa do cache persistente e força nova consulta ao Balloonerismm.
   * Usado em warm background paths quando o imdbId foi recém-resolvido (antes era null):
   * um sentinela __none__ gravado sem imdbId ou por erro transitório não deve bloquear
   * a busca correta. Só tem efeito quando cacheOnly = false.
   */
  bypassNegativeCache?: boolean;
  /** Injetada uma vez por request/lote; vazio desativa personalização explicitamente. */
  providerPreferences?: ProviderDisplayPreference[];
};

export const EMPTY_GROUPED_PROVIDERS: GroupedProviders = {
  flatrate: [],
  rent: [],
  buy: [],
  free: [],
  ads: [],
};

export const UNAVAILABLE_STATUS: AvailabilityStatus = {
  hasStreaming: false,
  hasRent: false,
  hasBuy: false,
  isAvailableSomewhere: false,
  isInTheaters: false,
  isFutureRelease: false,
  isUnavailable: true,
};

/**
 * Tipos do Trakt Index TOP 50.
 *
 * TraktIndexItem é a representação canônica depois da fusão/scoring dos 7 sinais.
 * Estrutura alinhada com o laboratório HTML de referência.
 */

export type TraktIndexSignalId =
  | "movies_trending"
  | "movies_favorited"
  | "movies_played"
  | "movies_watched"
  | "shows_trending"
  | "shows_favorited"
  | "shows_watched";

export type TraktIndexSignal = {
  id: TraktIndexSignalId;
  label: string;
  kind: "movie" | "show";
  endpoint: string;
  period: boolean;
  weight: number;
  metric: "watchers" | "user_count" | "play_count" | "watcher_count";
};

/** Entrada do sinal dentro de um item mesclado (espelha o "items" do resultado JSON). */
export type TraktIndexItemDetail = {
  signal: TraktIndexSignalId;
  label: string;
  rank: number;
  metric: number;
  title: string;
  year?: number | null;
  ids: TraktIndexIds;
};

export type TraktIndexIds = {
  trakt?: number;
  slug?: string;
  imdb?: string;
  tmdb?: number;
  tvdb?: number;
};

export type TraktIndexTranslation = {
  title: string | null;
  overview: string | null;
  tagline: string | null;
  language: string;
  country: string;
};

/** Sinais de recência/relevância usados pelo ranking "termômetro vivo". */
export type TrendingRecency = {
  /** Data base (released para filme, first_aired para série), ISO yyyy-mm-dd. */
  date: string | null;
  /** Idade em dias a partir de `date`; null quando a data é desconhecida. */
  ageDays: number | null;
  /** Lançamento/temporada recente dentro da janela de frescor. */
  isRecent: boolean;
  /** Presente em algum sinal `*_trending` (movimentação real agora), não só acumulado. */
  hasLiveSpike: boolean;
  /** Título antigo cujo ranking vem só de popularidade acumulada (sem spike atual). */
  isEvergreenWithoutSpike: boolean;
  /** Contribuição de recência somada ao score base (pode ser negativa via damp). */
  recencyScore: number;
};

export type TraktIndexItem = {
  rank: number;
  score: number;
  confidence: number;
  signalCount: number;
  /** Detalhes de cada sinal que contribuiu (equivale ao "items" do resultado JSON). */
  items: TraktIndexItemDetail[];

  mediaType: "movie" | "tv";

  // ─── Campos de compatibilidade PoplogTitle / TMDBItem ─────────────────────
  tmdb_id: number;
  media_type: "movie" | "tv";

  title: string;
  original_title: string | null;
  year: number | null;
  /** Date bruta do item (released para filmes, first_aired para séries). */
  date: string | null;
  overview: string | null;
  tagline: string | null;

  release_date: string | null;
  first_air_date: string | null;

  poster_path: string | null;
  backdrop_path: string | null;

  vote_average: number | null;
  vote_count: number | null;
  popularity: number | null;
  certification: string | null;
  runtime: number | null;
  genres: string[];
  network: string | null;
  status: string | null;
  trailer: string | null;

  ids: TraktIndexIds;

  /** Objeto de tradução pt-BR preservado separadamente (título/sinopse/tagline). */
  translation?: TraktIndexTranslation | null;

  /**
   * Versões localizadas armazenadas por idioma (fonte da verdade multilíngue).
   * `en-US` = dados originais do Trakt; `pt-BR` = tradução oficial quando existir.
   * A projeção para `title/overview/tagline` é feita por idioma no consumo.
   */
  localized?: Partial<import("@/lib/i18n/catalog-localization").CatalogLocalized>;

  /** Sinais de recência/relevância usados pelo ranking. */
  recency?: TrendingRecency;

  // ─── Campos de identidade POPLOG ──────────────────────────────────────────
  poplogId: null;
  externalIds: {
    tmdbId?: number;
    imdbId?: string;
    tvdbId?: number;
    traktId?: number;
    slug?: string;
  };
  identityUsed: "trakt_index";
  linkIdUsed: string | number;
  hasPoplogId: false;
  normalizedFrom: "trakt_index";
  legacyCompatibilityUsed: true;
};

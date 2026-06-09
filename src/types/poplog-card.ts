/**
 * Contrato canônico global para cards e itens exibíveis do POPLOG.
 *
 * Todas as seções (Home, Busca, Radar, Para Você, Recomendações, Watchlist,
 * Acompanhando, Biblioteca, Detalhes, Hero, Trending) devem derivar seus itens
 * deste contrato ou de uma extensão controlada dele.
 *
 * Nenhuma seção deve montar cards com campos id/title/posterUrl/href/userState
 * em estruturas próprias fora deste contrato.
 */

export type PoplogMediaType = "movie" | "tv";

/**
 * Metadado de cache padronizado para todas as respostas relevantes do POPLOG.
 *
 * Ciclo de vida esperado:
 *   now < expiresAt           → fresh   (servir normalmente)
 *   expiresAt ≤ now < staleAt → stale   (servir + disparar refresh em background)
 *   now ≥ staleAt             → expired (refresh síncrono ou fallback seguro)
 *   sem expiresAt/lastFetched → missing (nunca carregado)
 */
export type CacheMeta = {
  cacheStatus: "fresh" | "stale" | "expired" | "missing";
  lastFetchedAt: string | null;
  /** Quando o dado deixa de ser fresh, mas ainda pode ser retornado como stale. */
  expiresAt: string | null;
  /** Quando o dado é velho demais para ser servido sem refresh seguro. */
  staleAt: string | null;
  source: "trakt" | "local";
  sourceVersion?: string;
};

// ─── Ações disponíveis ────────────────────────────────────────────────────────

/**
 * Ações que podem ser exibidas para um título.
 * O frontend renderiza botões APENAS a partir desta lista — nunca inventa ações.
 */
export type UserAvailableAction =
  | "addToWatchlist"
  | "removeFromWatchlist"
  | "markAsWatched"
  | "markAsUnwatched"
  | "favorite"
  | "unfavorite"
  | "pause"
  | "drop"
  | "resume"
  | "removeFromLibrary";

// ─── Estado do usuário ────────────────────────────────────────────────────────

/**
 * Status de biblioteca canônico.
 * "favorite" e "dropped" são aliases expressivos mapeados de "watched"/"abandoned".
 */
export type PoplogLibraryStatus =
  | "watchlist"
  | "watching"
  | "watched"
  | "favorite"
  | "dropped"
  | "paused"
  | null;

/**
 * Contrato canônico de estado de usuário para cards e páginas.
 *
 * Vem do backend/engine — o frontend nunca calcula estes campos isoladamente.
 * `availableActions` é obrigatório: o frontend renderiza ações a partir desta lista.
 */
export type PoplogUserState = {
  inLibrary: boolean;
  status: PoplogLibraryStatus;
  isFavorite: boolean;
  isWatched: boolean;
  isInWatchlist: boolean;
  isDropped: boolean;
  /** Percentual de progresso (0–100). Presente para séries em andamento. */
  progressPercent?: number;
  /** Próximo episódio a assistir. Presente para séries com progresso. */
  nextEpisode?: {
    seasonNumber: number;
    episodeNumber: number;
    title?: string;
    airDate?: string;
  } | null;
  /** Lista de ações válidas para este item no estado atual. */
  availableActions: UserAvailableAction[];
  /** Se o usuário está autenticado. Determina se ações de usuário são renderizadas. */
  isAuthenticated: boolean;
  /** Computed state canônico para exibição de badge/chip. */
  computedState?: string | null;
};

/** Estado padrão para usuários não autenticados. */
export const UNAUTHENTICATED_USER_STATE: PoplogUserState = {
  inLibrary: false,
  status: null,
  isFavorite: false,
  isWatched: false,
  isInWatchlist: false,
  isDropped: false,
  availableActions: ["addToWatchlist", "markAsWatched", "favorite"],
  isAuthenticated: false,
};

/** Estado padrão para título sem estado de usuário (autenticado mas sem registro). */
export const EMPTY_USER_STATE: PoplogUserState = {
  inLibrary: false,
  status: null,
  isFavorite: false,
  isWatched: false,
  isInWatchlist: false,
  isDropped: false,
  availableActions: ["addToWatchlist", "markAsWatched", "favorite"],
  isAuthenticated: true,
};

// ─── Card canônico ────────────────────────────────────────────────────────────

/**
 * Contrato canônico de card/título do POPLOG.
 *
 * `href` é sempre derivado de `buildTitleHref` e aponta para
 * `/title/{mediaType}/{poplogId}` como URL canônica.
 */
export type PoplogCard = {
  poplogId: string;
  mediaType: PoplogMediaType;
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  href: string;
  userState: PoplogUserState;
  cacheMeta: CacheMeta;
  source: "trakt" | "local";
};

/**
 * Versão estendida de PoplogCard para cards que exibem mais metadados
 * (ex: cards de destaque no Hero, Radar, Para Você).
 */
export type PoplogCardExtended = PoplogCard & {
  overview?: string | null;
  genres?: string[];
  voteAverage?: number | null;
  numberOfSeasons?: number | null;
  releaseDate?: string | null;
  firstAirDate?: string | null;
  certificationBR?: string | null;
};

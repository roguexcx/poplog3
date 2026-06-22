/**
 * Estados oficiais de uma série na POPLOG.
 *
 * IMPORTANTE: estes estados descrevem a SÉRIE em si — não o usuário.
 * O progresso pessoal (em dia, atrasado, etc) é uma camada separada,
 * que vive em user_titles + user_episodes.
 *
 * - coming-soon          : primeira temporada ainda não estreou.
 * - episode-available    : um novo episódio saiu há pouco (default: 14 dias).
 * - in-season            : temporada em curso, com próximo episódio agendado.
 * - awaiting-next-season : série retorna, mas sem próximo episódio no ar.
 * - finished             : série encerrada (Ended / Canceled).
 * - unknown              : dados insuficientes pra decidir.
 */
export type SeriesState =
  | "coming-soon"
  | "episode-available"
  | "in-season"
  | "awaiting-next-season"
  | "finished"
  | "unknown";

/**
 * Estado de disponibilidade pra filmes (lifecycle bem mais simples).
 *
 * - coming-soon : data de estreia no futuro.
 * - released    : já estreou.
 * - unknown     : sem data.
 */
export type MovieState = "coming-soon" | "released" | "unknown";

/**
 * União dos dois estados, útil para badges genéricos.
 * Mantém os mesmos identificadores onde fazem sentido (coming-soon).
 */
export type TitleAvailabilityState = SeriesState | MovieState;

/**
 * Estado de produção de uma série conforme retornado pelo TMDB.
 * Representa o status editorial do show — não o progresso do usuário.
 *
 * - returning     : série em andamento, volta com novas temporadas
 * - ended         : encerrada definitivamente
 * - canceled      : cancelada
 * - hiatus        : pausa indefinida
 * - in_production : em produção (ainda não estreou ou entre temporadas)
 */
export type SeriesStatus =
  | "returning"
  | "ended"
  | "canceled"
  | "hiatus"
  | "in_production";

/**
 * Mini-estrutura "next/last episode" idêntica ao TMDB.
 * Usada como entrada das funções de estado.
 */
export type EpisodeStub = {
  air_date?: string | null;
};

export type SeriesStateInput = {
  firstAirDate?: string | null;
  lastAirDate?: string | null;
  /** Status bruto vindo do TMDB ("Returning Series", "Ended", "Canceled", "In Production", "Planned"). */
  tmdbStatus?: string | null;
  nextEpisodeToAir?: EpisodeStub | null;
  lastEpisodeToAir?: EpisodeStub | null;
  /** Para testar relógio. Default: new Date(). */
  now?: Date;
  /** Janela em dias para considerar um episódio "novo". Default: 14. */
  freshEpisodeWindowDays?: number;
};

export type MovieStateInput = {
  releaseDate?: string | null;
  now?: Date;
};

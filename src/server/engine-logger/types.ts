export type ApiName = "tmdb" | "omdb" | "watchmode" | "motn" | "balloonerismm" | "tvdb" | "trakt";

export type Origin =
  | "home"
  | "radar"
  /** Legacy alias accepted during the Agenda -> Radar transition. */
  | "agenda"
  | "hero"
  | "title"
  | "library"
  | "acompanhando"
  | "search"
  | "admin"
  | "unknown";

/** cache: Supabase cache hit; miss: foi ao provider externo; skipped: sem imdb_id etc. */
export type CacheStatus =
  | "hit"
  | "miss"
  | "stale"
  | "forced"
  | "failed"
  | "skipped"
  | "none";

export type EngineLogEntry = {
  id: number;
  ts: number; // unix ms
  api: ApiName;
  /** Ex: "sync-title", "sync-ratings", "sync-availability", "sync-season", "fetch" */
  op: string;
  origin: Origin;
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  /** path HTTP chamado, ex: "/movie/123" */
  endpoint?: string;
  cacheStatus: CacheStatus;
  durationMs: number;
  success: boolean;
  httpStatus?: number;
  error?: string;
  /** Quando houve fallback, API de origem que falhou */
  fallbackFrom?: ApiName;
};

export type ApiStats = {
  calls: number;
  hits: number;
  misses: number;
  errors: number;
  avgMs: number;
  maxMs: number;
  p95Ms: number;
  hitRate: number;
};

export type EngineStats = {
  startedAt: number;
  uptimeMs: number;
  totalCalls: number;
  cacheHitRate: number;
  perApi: Record<ApiName, ApiStats>;
  perOrigin: Record<string, number>;
  recentErrors: EngineLogEntry[];
};

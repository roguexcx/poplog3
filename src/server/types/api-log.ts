export type ApiLogEntry = {
  api: "tmdb" | "watchmode" | "movieofthenight" | "trakt" | "balloonerismm";

  endpoint: string;

  success: boolean;

  status?: number;

  response_time_ms?: number;

  cache_hit?: boolean;

  created_at: string;

  error_message?: string;
};

export type SyncSource =
  | "tmdb"
  | "omdb"
  | "watchmode"
  | "movieofthenight";

export type SyncStatus =
  | "idle"
  | "running"
  | "success"
  | "error";

export type SyncJobResult = {
  source: SyncSource;

  status: SyncStatus;

  started_at: string;

  finished_at?: string;

  affected_records?: number;

  error_message?: string;
};
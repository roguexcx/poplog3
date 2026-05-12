type ServerEnv = {
  tmdbApiKey: string | null;
  watchmodeApiKey: string | null;
  movieOfTheNightApiKey: string | null;
  adminSecret: string | null;
  tmdbDailyBudget: number;
  watchmodeMonthlyBudget: number;
  movieOfTheNightMonthlyBudget: number;
  watchmodeEnabled: boolean;
  movieOfTheNightEnabled: boolean;
  streamingSyncEnabled: boolean;
  streamingDebugLogs: boolean;
};

type ServerSecretName =
  | "TMDB_API_KEY"
  | "WATCHMODE_API_KEY"
  | "MOVIEOFTHENIGHT_API_KEY"
  | "ADMIN_SECRET";

function readEnvValue(name: ServerSecretName): string | null {
  assertServerRuntime();
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readBooleanFlag(name: string): boolean {
  assertServerRuntime();
  return process.env[name]?.trim().toLowerCase() === "true";
}

function readNumberEnv(name: string, fallback: number): number {
  assertServerRuntime();
  const value = Number(process.env[name]?.trim());
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("Variaveis de ambiente sensiveis so podem ser lidas no servidor.");
  }
}

export function getServerEnv(): ServerEnv {
  return {
    tmdbApiKey: readEnvValue("TMDB_API_KEY"),
    watchmodeApiKey: readEnvValue("WATCHMODE_API_KEY"),
    movieOfTheNightApiKey: readEnvValue("MOVIEOFTHENIGHT_API_KEY"),
    adminSecret: readEnvValue("ADMIN_SECRET"),
    tmdbDailyBudget: readNumberEnv("TMDB_DAILY_BUDGET", 1000),
    watchmodeMonthlyBudget: readNumberEnv("WATCHMODE_MONTHLY_BUDGET", 2500),
    movieOfTheNightMonthlyBudget: readNumberEnv("MOVIEOFTHENIGHT_MONTHLY_BUDGET", 500),
    watchmodeEnabled: readBooleanFlag("WATCHMODE_ENABLED"),
    movieOfTheNightEnabled: readBooleanFlag("MOVIEOFTHENIGHT_ENABLED"),
    streamingSyncEnabled: readBooleanFlag("STREAMING_SYNC_ENABLED"),
    streamingDebugLogs: readBooleanFlag("STREAMING_DEBUG_LOGS"),
  };
}

export function getRequiredServerEnv(name: ServerSecretName): string {
  const value = readEnvValue(name);
  if (!value) {
    throw new Error(`${name} nao configurada.`);
  }
  return value;
}

export function isWatchmodeEnabled(): boolean {
  return readBooleanFlag("WATCHMODE_ENABLED");
}

export function isMovieOfTheNightEnabled(): boolean {
  return readBooleanFlag("MOVIEOFTHENIGHT_ENABLED");
}

export function isStreamingSyncEnabled(): boolean {
  return readBooleanFlag("STREAMING_SYNC_ENABLED");
}

export function isStreamingDebugLogsEnabled(): boolean {
  return readBooleanFlag("STREAMING_DEBUG_LOGS");
}

export function isAdminSecretConfigured(): boolean {
  return readEnvValue("ADMIN_SECRET") !== null;
}

export function isValidAdminSecret(value: string | null): boolean {
  const adminSecret = readEnvValue("ADMIN_SECRET");
  return Boolean(adminSecret && value && value === adminSecret);
}

export function getApiBudgetEnv() {
  return {
    tmdbDailyBudget: readNumberEnv("TMDB_DAILY_BUDGET", 1000),
    watchmodeMonthlyBudget: readNumberEnv("WATCHMODE_MONTHLY_BUDGET", 2500),
    movieOfTheNightMonthlyBudget: readNumberEnv("MOVIEOFTHENIGHT_MONTHLY_BUDGET", 500),
  };
}

import type {
  AvailabilitySource,
  CacheStatus,
  EngineApi,
  MediaType,
  PremiumApi,
} from "@prisma/client";

export type RepositoryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type RepositoryVoidResult = RepositoryResult<null>;

export type EngineLogInput = {
  ts?: Date | string | number;
  api: EngineApi;
  op: string;
  origin: string;
  mediaType?: MediaType | null;
  tmdbId?: number | null;
  endpoint?: string | null;
  cacheStatus: CacheStatus;
  durationMs: number;
  success: boolean;
  httpStatus?: number | null;
  error?: string | null;
  fallbackFrom?: EngineApi | null;
};

export type ApiUsageDailyInput = {
  day: Date | string;
  api: EngineApi;
  totalCalls?: number;
  cacheHits?: number;
  errors?: number;
  avgMs?: number;
  maxMs?: number;
  p95Ms?: number;
};

export type PremiumApiUsageInput = {
  api: PremiumApi;
  periodDay: Date | string;
  periodMonth: string;
  endpoint?: string | null;
  tmdbId?: number | null;
  mediaType?: MediaType | null;
  region?: string | null;
  userId?: string | null;
  action?: string | null;
  reason?: string | null;
  status?: string;
  dailyUsed?: number | null;
  dailyLimit?: number | null;
  monthlyUsed?: number | null;
  monthlyLimit?: number | null;
  error?: string | null;
};

export type IcsAgendaCacheEntry<T> = {
  payload: T;
  cachedAt: string;
  ageHours: number;
  status: "hit" | "stale";
};

export type ContinuitySectionCacheEntry<T> = {
  payload: T;
  status: "hit" | "stale";
  expiresAt: string;
  updatedAt: string;
};

export type ContinuitySectionCacheKey = {
  sectionKey: string;
  userId?: string | null;
  region?: string | null;
  language?: string | null;
};

export type TitleAvailabilityWriteInput = {
  tmdbId: number;
  mediaType: MediaType;
  providerName: string;
  country: string;
  availabilityType: "streaming" | "rent" | "buy" | "free" | "ads";
  source: AvailabilitySource;
};

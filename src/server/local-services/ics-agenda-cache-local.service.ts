import {
  deleteIcsAgendaCache,
  readIcsAgendaCache,
  writeIcsAgendaCache,
} from "@/server/repositories";

const DEFAULT_CACHE_ID = "main";
const DEFAULT_TTL_HOURS = 24;

export async function readCache<T>(input: {
  id?: string;
  ttlHours?: number;
  cacheVersion?: unknown;
} = {}): Promise<{ payload: T; cachedAt: string } | null> {
  const result = await readIcsAgendaCache<T>({
    id: input.id ?? DEFAULT_CACHE_ID,
    ttlHours: input.ttlHours ?? DEFAULT_TTL_HOURS,
  });
  if (!result.ok || !result.data || result.data.status !== "hit") return null;

  const payload = result.data.payload as Record<string, unknown>;
  if (input.cacheVersion !== undefined && payload?.cacheVersion !== input.cacheVersion) {
    return null;
  }

  return {
    payload: result.data.payload,
    cachedAt: result.data.cachedAt,
  };
}

export async function writeCache<T>(payload: T, input: {
  id?: string;
  cachedAt?: Date;
} = {}): Promise<boolean> {
  const result = await writeIcsAgendaCache({
    id: input.id ?? DEFAULT_CACHE_ID,
    payload,
    cachedAt: input.cachedAt,
  });
  return result.ok;
}

export async function getCacheAgeHours(id = DEFAULT_CACHE_ID): Promise<number | null> {
  const result = await readIcsAgendaCache<unknown>({ id, ttlHours: Number.POSITIVE_INFINITY });
  if (!result.ok || !result.data) return null;
  return result.data.ageHours;
}

export async function deleteCache(id = DEFAULT_CACHE_ID): Promise<boolean> {
  const result = await deleteIcsAgendaCache(id);
  return result.ok;
}

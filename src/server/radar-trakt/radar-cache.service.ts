import { readContinuitySectionCache, writeContinuitySectionCache } from "@/server/continuity/continuity-section-cache";
import type { RadarPayload } from "./types";

const CACHE_TTL_MS = 60 * 60_000;
const MEMORY_TTL_MS = 10 * 60_000;
const STALE_MS = 6 * 60 * 60_000;

type MemoryEntry = { payload: RadarPayload; expiresAt: number; staleUntil: number };
const memory = new Map<string, MemoryEntry>();
const rebuildLocks = new Map<string, Promise<RadarPayload>>();

export function radarCacheKey(region: string, language: string, windowDays: number) {
  return `radar_trakt_general:v3:${region}:${language}:${windowDays}`;
}

export async function getRadarCachedPayload(
  key: string,
  region: string,
  language: string,
  rebuild: () => Promise<RadarPayload>,
): Promise<RadarPayload> {
  const now = Date.now();
  const mem = memory.get(key);
  if (mem && mem.expiresAt > now) return { ...mem.payload, fromCache: true, generatedAt: new Date().toISOString() };

  const cached = await readContinuitySectionCache<RadarPayload>(key, { region, language });
  if (cached?.status === "hit") {
    setMemory(key, cached.payload);
    return { ...cached.payload, fromCache: true, generatedAt: new Date().toISOString() };
  }

  if (mem && mem.staleUntil > now) {
    void rebuildLocked(key, region, language, rebuild);
    return { ...mem.payload, fromCache: true, generatedAt: new Date().toISOString() };
  }

  if (cached?.status === "stale") {
    void rebuildLocked(key, region, language, rebuild);
    return { ...cached.payload, fromCache: true, generatedAt: new Date().toISOString() };
  }

  return rebuildLocked(key, region, language, rebuild);
}

export async function invalidateRadarCache(region = "BR", language = "pt-BR") {
  for (const key of [...memory.keys()]) {
    if (key.includes(`:${region}:${language}:`)) memory.delete(key);
  }
}

async function rebuildLocked(
  key: string,
  region: string,
  language: string,
  rebuild: () => Promise<RadarPayload>,
): Promise<RadarPayload> {
  const existing = rebuildLocks.get(key);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const payload = await rebuild();
      setMemory(key, payload);
      await writeContinuitySectionCache({
        sectionKey: key,
        region,
        language,
        ttlMs: CACHE_TTL_MS,
        payload,
      });
      return payload;
    } finally {
      rebuildLocks.delete(key);
    }
  })();
  rebuildLocks.set(key, promise);
  return promise;
}

function setMemory(key: string, payload: RadarPayload) {
  const now = Date.now();
  memory.set(key, {
    payload: { ...payload, cachedAt: new Date().toISOString() },
    expiresAt: now + MEMORY_TTL_MS,
    staleUntil: now + STALE_MS,
  });
}

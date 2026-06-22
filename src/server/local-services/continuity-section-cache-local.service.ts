import {
  invalidateContinuitySectionCache as invalidateRepositoryCache,
  readContinuitySectionCache as readRepositoryCache,
  writeContinuitySectionCache as writeRepositoryCache,
} from "@/server/repositories";

export type ContinuitySectionCacheStatus = "hit" | "stale" | "miss" | "error";

export type ContinuitySectionCacheEntry<T> = {
  payload: T;
  status: Exclude<ContinuitySectionCacheStatus, "miss" | "error">;
  expiresAt: string;
  updatedAt: string;
};

export async function readContinuitySectionCache<T>(
  sectionKey: string,
  options: {
    userId?: string | null;
    region?: string | null;
    language?: string | null;
  } = {},
): Promise<ContinuitySectionCacheEntry<T> | null> {
  const result = await readRepositoryCache<T>({
    sectionKey,
    userId: options.userId ?? null,
    region: options.region ?? null,
    language: options.language ?? null,
  });
  return result.ok ? result.data : null;
}

export async function writeContinuitySectionCache<T>(input: {
  sectionKey: string;
  userId?: string | null;
  region?: string | null;
  language?: string | null;
  payload: T;
  ttlMs: number;
}): Promise<boolean> {
  // Repassa o resultado do repositório (ok/erro) — não engole a falha. Callers de
  // produção fazem fire-and-forget (cache best-effort), mas testes/diagnósticos
  // precisam saber se a escrita realmente persistiu.
  const result = await writeRepositoryCache(input);
  return result.ok;
}

export function invalidateContinuitySectionCache(userId: string): void {
  void invalidateRepositoryCache({ userId });
}

export async function invalidateContinuitySectionCacheLocal(input: {
  userId?: string | null;
  sectionKey?: string;
} = {}): Promise<boolean> {
  const result = await invalidateRepositoryCache(input);
  return result.ok;
}

import { db } from "@/server/db/client";

/**
 * Tempo de vida do lock em segundos. Se o worker travar, o lock expira
 * automaticamente e outro pode pegar o trabalho.
 */
const LOCK_TTL_SECONDS = 90;

/**
 * Chaves de refresh predefinidas para as seções do sistema.
 * Evita que múltiplas requisições paralelas chamem a Trakt ao mesmo tempo
 * para a mesma seção ou título.
 *
 * Exemplos de uso:
 *   titleRefreshKey("movie", "clpxxx") → "title:movie:clpxxx"
 *   sectionRefreshKey("home:trending") → "section:home:trending"
 *   recommendationsRefreshKey("clpxxx") → "recommendations:clpxxx"
 */
export function titleRefreshKey(mediaType: string, poplogId: string): string {
  return `title:${mediaType}:${poplogId}`;
}

export function sectionRefreshKey(section: string): string {
  return `section:${section}`;
}

export function recommendationsRefreshKey(poplogId: string): string {
  return `recommendations:${poplogId}`;
}

type AcquireResult =
  | { acquired: true; lockId: string }
  | { acquired: false; reason: "already_locked" | "db_error" };

/**
 * Tenta adquirir lock exclusivo para uma chave de refresh.
 *
 * Se já houver um lock ativo (lockedUntil > now), retorna acquired=false.
 * O lock é implementado via `PoplogRefreshQueue` usando o campo `lockedUntil`.
 * Não requer Redis — funciona com o banco MySQL/Postgres existente.
 *
 * Para ambientes futuros com Redis ou lock distribuído, basta substituir
 * esta implementação sem mudar a interface.
 */
export async function acquireRefreshLock(
  cacheKey: string,
  kind: string,
): Promise<AcquireResult> {
  const now = new Date();

  try {
    const existing = await db.poplogRefreshQueue.findUnique({
      where: { cacheKey_kind: { cacheKey, kind } },
      select: { lockedUntil: true, status: true },
    });

    if (existing?.lockedUntil && existing.lockedUntil > now) {
      return { acquired: false, reason: "already_locked" };
    }

    const lockedUntil = new Date(now.getTime() + LOCK_TTL_SECONDS * 1_000);

    await db.poplogRefreshQueue.upsert({
      where: { cacheKey_kind: { cacheKey, kind } },
      update: { lockedUntil, status: "running" },
      create: {
        cacheKey,
        kind,
        lockedUntil,
        status: "running",
        runAfter: now,
      },
    });

    return { acquired: true, lockId: `${cacheKey}:${kind}` };
  } catch {
    return { acquired: false, reason: "db_error" };
  }
}

/**
 * Libera o lock após conclusão do refresh (sucesso ou falha).
 */
export async function releaseRefreshLock(
  cacheKey: string,
  kind: string,
  outcome: "completed" | "failed" = "completed",
): Promise<void> {
  await db.poplogRefreshQueue
    .updateMany({
      where: { cacheKey, kind },
      data: { lockedUntil: null, status: outcome },
    })
    .catch(() => null);
}

/**
 * Executa um refresh protegido contra stampede.
 *
 * - Se outro worker já tiver o lock, retorna { skipped: true }.
 * - Caso contrário, adquire o lock, executa `fn`, libera o lock.
 * - Erros dentro de `fn` liberam o lock com status "failed" e são relançados.
 */
export async function withRefreshLock<T>(
  cacheKey: string,
  kind: string,
  fn: () => Promise<T>,
): Promise<{ result: T; skipped: false } | { skipped: true }> {
  const lock = await acquireRefreshLock(cacheKey, kind);
  if (!lock.acquired) return { skipped: true };

  try {
    const result = await fn();
    await releaseRefreshLock(cacheKey, kind, "completed");
    return { result, skipped: false };
  } catch (error) {
    await releaseRefreshLock(cacheKey, kind, "failed");
    throw error;
  }
}

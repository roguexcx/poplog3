/**
 * Verifica frescor TEMPORAL do cache de titulo.
 *
 * Default 7 dias. Se o cache estiver fora dessa janela, e considerado stale.
 */
export function isTitleCacheFresh(
  lastSyncedAt?: string | null,
  maxAgeDays = 7
) {
  if (!lastSyncedAt) {
    return false;
  }

  const syncedTime = new Date(lastSyncedAt).getTime();

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  return Date.now() - syncedTime < maxAgeMs;
}

/**
 * Verifica COMPLETUDE do payload TMDB cacheado.
 *
 * O cache pode estar dentro da janela temporal mas com campos faltando
 * porque o sync original foi feito antes de adicionarmos novas extensoes
 * ao append_to_response (ex: watch/providers, external_ids). Nessa
 * situacao, forcamos um re-sync mesmo com o cache "fresco" temporalmente.
 *
 * Retorna `true` se o payload tem todos os campos esperados — false caso
 * contrario.
 */
export function isTitlePayloadComplete(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as Record<string, unknown>;

  // Campos que esperamos ver no append_to_response atual.
  const requiredKeys = [
    "credits",
    "videos",
    "recommendations",
    "external_ids",
    "watch/providers",
  ];

  return requiredKeys.every((key) => key in obj);
}

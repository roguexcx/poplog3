/**
 * feedbackBatchLoader
 *
 * Micro-batcher client-side para leituras de feedback.
 * Todos os useUserFeedbackToggle que montam no mesmo ciclo de render
 * (tipicamente todos os cards de uma lista) enfileiram sua leitura aqui.
 * Após FLUSH_DELAY_MS sem novas entradas, disparamos UM único POST para
 * /api/user/feedback/batch e resolvemos todas as Promises de uma vez.
 *
 * Isso substitui as N chamadas GET /api/user/feedback?tmdb_id=... individuais
 * que apareciam nos logs quando uma página carregava com muitos cards.
 */

import type { MediaType } from "@/types/user";
import type { TitleFeedbackState } from "@/lib/personalization/feedback";

// Aguarda esse tempo (ms) após o último enqueue antes de disparar o batch.
// 30 ms é suficiente para coletar todos os cards de um render síncrono.
const FLUSH_DELAY_MS = 90;
const MEMORY_TTL_MS = 5 * 60 * 1000;
const DISABLED_TTL_MS = 5 * 60 * 1000;

type QueueItem = {
  tmdbId: number;
  mediaType: MediaType;
  resolve: (state: TitleFeedbackState) => void;
  aborted: boolean;
};

let pendingQueue: QueueItem[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const memoryCache = new Map<string, { state: TitleFeedbackState; expiresAt: number }>();
const inFlight = new Map<string, Promise<TitleFeedbackState>>();
let endpointDisabledUntil = 0;

const NEUTRAL_STATE: TitleFeedbackState = {
  notInterested: false,
  activeFeedbackTypes: [],
};

function flushQueue(): void {
  const batch = pendingQueue;
  pendingQueue = [];
  flushTimer = null;

  const now = Date.now();
  const active = batch.filter((item) => {
    if (item.aborted) return false;
    const key = `${item.mediaType}:${item.tmdbId}`;
    const cached = memoryCache.get(key);
    if (cached && cached.expiresAt > now) {
      item.resolve(cached.state);
      return false;
    }
    const pending = inFlight.get(key);
    if (pending) {
      pending.then((state) => item.resolve(state)).catch(() => item.resolve(NEUTRAL_STATE));
      return false;
    }
    return true;
  });
  if (active.length === 0) return;

  if (endpointDisabledUntil > Date.now()) {
    for (const item of active) item.resolve(NEUTRAL_STATE);
    return;
  }

  // Deduplica itens idênticos para não inflar o payload (mesma chave, vários cards)
  const seen = new Set<string>();
  const uniqueItems = active.filter((item) => {
    const key = `${item.mediaType}:${item.tmdbId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueItems.length === 0) return;

  const jsonPromise: Promise<{ results?: Record<string, TitleFeedbackState> } | null> =
    fetch("/api/user/feedback/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: uniqueItems.map((item) => ({
        tmdb_id: item.tmdbId,
        media_type: item.mediaType,
      })),
    }),
  }).then((res) => {
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      endpointDisabledUntil = Date.now() + DISABLED_TTL_MS;
      return null;
    }
    return res.ok ? res.json() : null;
  });

  for (const item of uniqueItems) {
    const key = `${item.mediaType}:${item.tmdbId}`;
    inFlight.set(
      key,
      jsonPromise
        .then((json: { results?: Record<string, TitleFeedbackState> } | null) => {
          const state = json?.results?.[key] ?? NEUTRAL_STATE;
          memoryCache.set(key, { state, expiresAt: Date.now() + MEMORY_TTL_MS });
          return state;
        })
        .finally(() => inFlight.delete(key)),
    );
  }

  jsonPromise
    .then((json: { results?: Record<string, TitleFeedbackState> } | null) => {
      for (const item of active) {
        if (item.aborted) continue;
        const key = `${item.mediaType}:${item.tmdbId}`;
        const state = json?.results?.[key] ?? NEUTRAL_STATE;
        memoryCache.set(key, { state, expiresAt: Date.now() + MEMORY_TTL_MS });
        item.resolve(state);
      }
    })
    .catch(() => {
      for (const item of active) {
        if (!item.aborted) item.resolve(NEUTRAL_STATE);
      }
    });
}

/**
 * Enfileira uma leitura de feedback para o próximo batch.
 * Retorna uma Promise que resolve com o TitleFeedbackState do título.
 * Se o AbortSignal for acionado antes do flush, o item é marcado como
 * cancelado e sua Promise nunca resolve (evita setState em componente desmontado).
 */
export function enqueueFeedbackBatch(
  tmdbId: number,
  mediaType: MediaType,
  signal: AbortSignal,
): Promise<TitleFeedbackState> {
  return new Promise((resolve) => {
    const item: QueueItem = { tmdbId, mediaType, resolve, aborted: false };
    signal.addEventListener("abort", () => {
      item.aborted = true;
    });
    pendingQueue.push(item);
    if (!flushTimer) {
      flushTimer = setTimeout(flushQueue, FLUSH_DELAY_MS);
    }
  });
}

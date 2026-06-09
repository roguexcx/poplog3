"use client";

/**
 * Fila de ações do usuário com debounce por poplogId e AbortController.
 *
 * Objetivo: evitar race conditions quando o usuário clica rapidamente em ações
 * opostas (marcar/desmarcar, adicionar/remover). Apenas o estado final após o
 * período de debounce é enviado para a API. Requisições anteriores em andamento
 * são canceladas via AbortController.
 *
 * Uso:
 *   const { enqueue } = useActionQueue();
 *   enqueue(poplogId, async (signal) => { await callApi(payload, signal); });
 */

const DEBOUNCE_MS = 300;

type ActionFn = (signal: AbortSignal) => Promise<void>;

type QueueEntry = {
  timer: ReturnType<typeof setTimeout>;
  controller: AbortController;
  fn: ActionFn;
};

/** Singleton global — sobrevive re-renders. */
const queue = new Map<string, QueueEntry>();

/**
 * Enfileira uma ação para um `poplogId` com debounce.
 *
 * Se uma ação anterior ainda estiver pendente para o mesmo poplogId:
 *   1. Aborta a requisição em andamento (se houver).
 *   2. Cancela o timer de debounce.
 *   3. Agenda a nova ação com delay fresco.
 *
 * Após o debounce, executa `fn(signal)`. Erros são capturados e logados —
 * o caller deve aplicar optimistic revert antes de enfileirar.
 */
export function enqueueUserAction(
  poplogId: string,
  fn: ActionFn,
  onError?: (error: unknown) => void,
): void {
  const existing = queue.get(poplogId);

  if (existing) {
    clearTimeout(existing.timer);
    existing.controller.abort();
  }

  const controller = new AbortController();

  const timer = setTimeout(async () => {
    queue.delete(poplogId);
    try {
      await fn(controller.signal);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      console.error(`[action-queue] ação falhou para ${poplogId}:`, error);
      onError?.(error);
    }
  }, DEBOUNCE_MS);

  queue.set(poplogId, { timer, controller, fn });
}

/**
 * Cancela qualquer ação pendente para um poplogId.
 * Útil para unmount de componentes.
 */
export function cancelPendingAction(poplogId: string): void {
  const existing = queue.get(poplogId);
  if (!existing) return;
  clearTimeout(existing.timer);
  existing.controller.abort();
  queue.delete(poplogId);
}

/**
 * Retorna true se há uma ação pendente para o poplogId (em debounce ou em voo).
 */
export function hasPendingAction(poplogId: string): boolean {
  return queue.has(poplogId);
}

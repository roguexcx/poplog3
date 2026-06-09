"use client";

import { useCallback, useRef } from "react";
import { useUserStatesStore } from "@/stores/user-states-store";
import { enqueueUserAction } from "@/lib/user-actions/action-queue";
import { notifyUserTitlesUpdated } from "@/hooks/useTitleToggle";
import type { PoplogUserState, UserAvailableAction } from "@/types/poplog-card";
import type { MediaType } from "@/lib/user-title-service";

type ActionInput = {
  /** CUID canônico da DB. Quando ausente, tmdbId é obrigatório como fallback. */
  poplogId?: string | null;
  /** Obrigatório quando poplogId é ausente. Usado como chave de fila e no body da API. */
  tmdbId?: number | null;
  mediaType: MediaType;
  imdbId?: string | null;
  slug?: string | null;
  title: string;
  releaseYear?: number | null;
};

type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

type UseUserActionReturn = {
  executeAction: (action: UserAvailableAction) => Promise<ActionResult>;
  isSaving: boolean;
  /** Chave canônica usada no Zustand — poplogId quando disponível, senão "tmdb:{tmdbId}:{mediaType}" */
  effectiveKey: string;
};

/**
 * Hook unificado para todas as ações de usuário em cards e páginas de título.
 *
 * Funciona com ou sem poplogId real (CUID). Quando ausente, usa tmdbId como
 * chave para o Zustand e para a fila de debounce.
 *
 * Fluxo:
 *   1. Aplica optimistic update no Zustand imediatamente.
 *   2. Enfileira chamada de API com debounce 300ms por chave.
 *   3. AbortController cancela requisição anterior se nova ação chegar antes.
 *   4. Em caso de erro da API, reverte o estado otimista.
 *   5. Dispara `notifyUserTitlesUpdated()` para propagar o estado ao UserDataContext.
 */
export function useUserAction({
  poplogId,
  tmdbId,
  mediaType,
  imdbId,
  slug,
  title,
  releaseYear,
}: ActionInput): UseUserActionReturn {
  const { userStatesById, setUserState, patchUserState } = useUserStatesStore();

  // Chave canônica: poplogId real quando disponível, senão derivada do tmdbId
  const effectiveKey = poplogId || `tmdb:${tmdbId}:${mediaType}`;

  const isSavingRef = useRef(false);

  const executeAction = useCallback(
    async (action: UserAvailableAction): Promise<ActionResult> => {
      const currentState = userStatesById[effectiveKey] ?? null;

      // Optimistic update — cria estado inicial se o item ainda não está no Zustand
      const optimisticState = buildOptimisticState(action, currentState, mediaType);
      if (optimisticState) {
        setUserState(effectiveKey, optimisticState);
      } else {
        const patch = buildOptimisticPatch(action, currentState, mediaType);
        if (patch && currentState) {
          patchUserState(effectiveKey, patch);
        }
      }

      isSavingRef.current = true;

      return new Promise<ActionResult>((resolve) => {
        enqueueUserAction(
          effectiveKey,
          async (signal) => {
            try {
              await callActionApi(action, {
                poplogId: isRealPoplogId(poplogId) ? poplogId : undefined,
                tmdbId: tmdbId ?? undefined,
                mediaType,
                imdbId: imdbId ?? undefined,
                slug: slug ?? undefined,
                title,
                releaseYear: releaseYear ?? undefined,
                signal,
              });
              notifyUserTitlesUpdated();
              isSavingRef.current = false;
              resolve({ ok: true });
            } catch (error) {
              // Revert optimistic update on failure
              if (currentState) {
                setUserState(effectiveKey, currentState);
              } else {
                // Remove the optimistic entry we created
                const { [effectiveKey]: _removed, ...rest } = userStatesById;
                void _removed; // suppress unused var
                setUserState(effectiveKey, null as unknown as PoplogUserState);
              }
              isSavingRef.current = false;
              resolve({
                ok: false,
                error: error instanceof Error ? error.message : "Erro desconhecido",
              });
            }
          },
          (error) => {
            if (currentState) {
              setUserState(effectiveKey, currentState);
            }
            isSavingRef.current = false;
            resolve({
              ok: false,
              error: error instanceof Error ? error.message : "Erro desconhecido",
            });
          },
        );
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveKey, mediaType, tmdbId, imdbId, slug, title, releaseYear, userStatesById, setUserState, patchUserState],
  );

  return {
    executeAction,
    isSaving: isSavingRef.current,
    effectiveKey,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Verifica se o poplogId é um CUID real (não uma chave derivada "tmdb:...") */
function isRealPoplogId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.length > 0 && !id.startsWith("tmdb:");
}

/**
 * Para itens sem estado no Zustand (primeira adição à biblioteca),
 * constrói um estado completo em vez de um patch parcial.
 * Retorna null quando o item já tem estado (use `buildOptimisticPatch` nesses casos).
 */
function buildOptimisticState(
  action: UserAvailableAction,
  currentState: PoplogUserState | null,
  _mediaType: MediaType,
): PoplogUserState | null {
  if (currentState !== null) return null; // item já tem estado → usa patch

  switch (action) {
    case "addToWatchlist":
      return {
        inLibrary: true,
        status: "watchlist",
        isFavorite: false,
        isWatched: false,
        isInWatchlist: true,
        isDropped: false,
        availableActions: ["removeFromWatchlist", "markAsWatched", "favorite"],
        isAuthenticated: true,
      };
    case "markAsWatched":
      return {
        inLibrary: true,
        status: "watched",
        isFavorite: false,
        isWatched: true,
        isInWatchlist: false,
        isDropped: false,
        availableActions: ["markAsUnwatched", "favorite", "removeFromLibrary"],
        isAuthenticated: true,
      };
    case "favorite":
      return {
        inLibrary: true,
        status: "favorite",
        isFavorite: true,
        isWatched: true,
        isInWatchlist: false,
        isDropped: false,
        availableActions: ["unfavorite", "markAsUnwatched", "removeFromLibrary"],
        isAuthenticated: true,
      };
    default:
      return null;
  }
}

function buildOptimisticPatch(
  action: UserAvailableAction,
  current: PoplogUserState | null,
  _mediaType: MediaType,
): Partial<PoplogUserState> | null {
  switch (action) {
    case "addToWatchlist":
      return {
        inLibrary: true,
        status: "watchlist",
        isInWatchlist: true,
        availableActions: current?.availableActions?.filter((a) => a !== "addToWatchlist")
          .concat(["removeFromWatchlist"]) ?? [],
      };
    case "removeFromWatchlist":
      return {
        inLibrary: false,
        status: null,
        isInWatchlist: false,
        availableActions: current?.availableActions?.filter((a) => a !== "removeFromWatchlist")
          .concat(["addToWatchlist"]) ?? [],
      };
    case "markAsWatched":
      return {
        inLibrary: true,
        status: "watched",
        isWatched: true,
        isInWatchlist: false,
        availableActions: current?.availableActions?.filter((a) => a !== "markAsWatched" && a !== "addToWatchlist")
          .concat(["markAsUnwatched"]) ?? [],
      };
    case "markAsUnwatched":
      return {
        isWatched: false,
        status: null,
        inLibrary: false,
        availableActions: current?.availableActions?.filter((a) => a !== "markAsUnwatched")
          .concat(["markAsWatched"]) ?? [],
      };
    case "favorite":
      return { isFavorite: true, status: "favorite" };
    case "unfavorite":
      return { isFavorite: false };
    case "drop":
      return {
        status: "dropped",
        isDropped: true,
        availableActions: current?.availableActions?.filter((a) => a !== "drop")
          .concat(["resume"]) ?? [],
      };
    case "resume":
      return {
        status: "watching",
        isDropped: false,
        availableActions: current?.availableActions?.filter((a) => a !== "resume")
          .concat(["drop", "pause"]) ?? [],
      };
    case "removeFromLibrary":
      return {
        inLibrary: false,
        status: null,
        isFavorite: false,
        isWatched: false,
        isInWatchlist: false,
        isDropped: false,
        progressPercent: undefined,
        nextEpisode: undefined,
        availableActions: ["addToWatchlist", "markAsWatched", "favorite"],
      };
    default:
      return null;
  }
}

type ApiCallInput = {
  poplogId?: string;
  tmdbId?: number;
  mediaType: MediaType;
  imdbId?: string;
  slug?: string;
  title: string;
  releaseYear?: number;
  signal: AbortSignal;
};

async function callActionApi(
  action: UserAvailableAction,
  input: ApiCallInput,
): Promise<void> {
  const { poplogId, tmdbId, mediaType, imdbId, slug, title, releaseYear, signal } = input;

  const baseBody: Record<string, unknown> = { mediaType, title };
  if (poplogId)    baseBody.poplogId    = poplogId;
  if (tmdbId)      baseBody.tmdbId      = tmdbId;
  if (imdbId)      baseBody.imdbId      = imdbId;
  if (slug)        baseBody.slug        = slug;
  if (releaseYear) baseBody.releaseYear = releaseYear;

  const fetchOpts = (method: string, body?: Record<string, unknown>) => ({
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  let res: Response;

  switch (action) {
    case "addToWatchlist":
      res = await fetch("/api/library/title", fetchOpts("POST", { ...baseBody, status: "watchlist" }));
      break;
    case "removeFromWatchlist":
    case "removeFromLibrary":
      res = await fetch("/api/library/title", fetchOpts("DELETE", baseBody));
      break;
    case "markAsWatched":
      res = await fetch("/api/library/title", fetchOpts("POST", { ...baseBody, status: "watched" }));
      break;
    case "markAsUnwatched":
      res = await fetch("/api/library/title", fetchOpts("DELETE", baseBody));
      break;
    case "favorite":
      res = await fetch("/api/library/title", fetchOpts("PATCH", { ...baseBody, favorite: true }));
      break;
    case "unfavorite":
      res = await fetch("/api/library/title", fetchOpts("PATCH", { ...baseBody, favorite: false }));
      break;
    case "drop":
      res = await fetch("/api/library/title", fetchOpts("POST", { ...baseBody, status: "abandoned" }));
      break;
    case "resume":
      res = await fetch("/api/library/title", fetchOpts("POST", { ...baseBody, status: "watching" }));
      break;
    case "pause":
      res = await fetch("/api/library/title", fetchOpts("POST", { ...baseBody, status: "fridge" }));
      break;
    default:
      return;
  }

  if (!res.ok && res.status !== 401) {
    throw new Error(`API ${action} retornou ${res.status}`);
  }
}

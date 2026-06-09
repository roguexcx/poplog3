"use client";

import { create } from "zustand";
import type { PoplogUserState } from "@/types/poplog-card";

type UserStatesState = {
  userStatesById: Record<string, PoplogUserState>;
  setUserState: (poplogId: string, state: PoplogUserState) => void;
  setUserStates: (states: Record<string, PoplogUserState>) => void;
  patchUserState: (poplogId: string, patch: Partial<PoplogUserState>) => void;
  removeUserState: (poplogId: string) => void;
  clearUserStates: () => void;
};

/**
 * Store normalizada de estado de usuário por título.
 *
 * Separada de `EntitiesStore` para que uma ação do usuário (ex: marcar como
 * assistido) atualize apenas o estado relevante sem reescrever dados do título.
 *
 * Quando um poplogId aparece em múltiplas seções (Home, Radar, Para Você),
 * uma única atualização aqui reflete em todos os cards simultaneamente.
 */
export const useUserStatesStore = create<UserStatesState>((set) => ({
  userStatesById: {},

  setUserState: (poplogId, state) =>
    set((prev) => ({
      userStatesById: { ...prev.userStatesById, [poplogId]: state },
    })),

  setUserStates: (states) =>
    set((prev) => ({
      userStatesById: { ...prev.userStatesById, ...states },
    })),

  patchUserState: (poplogId, patch) =>
    set((prev) => {
      const current = prev.userStatesById[poplogId];
      if (!current) return prev;
      return {
        userStatesById: {
          ...prev.userStatesById,
          [poplogId]: { ...current, ...patch },
        },
      };
    }),

  removeUserState: (poplogId) =>
    set((prev) => {
      const next = { ...prev.userStatesById };
      delete next[poplogId];
      return { userStatesById: next };
    }),

  clearUserStates: () => set({ userStatesById: {} }),
}));

/** Hook de conveniência — lê o estado de um título por poplogId. */
export function usePoplogUserState(
  poplogId: string | null | undefined,
): PoplogUserState | undefined {
  return useUserStatesStore((state) =>
    poplogId ? state.userStatesById[poplogId] : undefined,
  );
}

"use client";

import { create } from "zustand";
import type { CacheMeta, PoplogMediaType } from "@/types/poplog-card";

/**
 * Dados estáticos de um título — não mudam por ação do usuário.
 * Indexados por `poplogId` para deduplicação entre seções.
 */
export type EntityData = {
  poplogId: string;
  mediaType: PoplogMediaType;
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  href: string;
  cacheMeta: CacheMeta;
  source: "trakt" | "local";
};

type EntitiesState = {
  entitiesById: Record<string, EntityData>;
  setEntity: (entity: EntityData) => void;
  setEntities: (entities: EntityData[]) => void;
  removeEntity: (poplogId: string) => void;
  clearEntities: () => void;
};

/**
 * Store normalizada de dados de título.
 *
 * Um mesmo título aparece em várias seções (Home, Radar, Search, etc.)
 * mas deve existir como uma única entidade aqui. Mudanças de metadado
 * (posterUrl, title, etc.) atualizam todos os cards que exibem aquele poplogId.
 */
export const useEntitiesStore = create<EntitiesState>((set) => ({
  entitiesById: {},

  setEntity: (entity) =>
    set((state) => ({
      entitiesById: { ...state.entitiesById, [entity.poplogId]: entity },
    })),

  setEntities: (entities) =>
    set((state) => {
      const updates: Record<string, EntityData> = {};
      for (const entity of entities) {
        updates[entity.poplogId] = entity;
      }
      return { entitiesById: { ...state.entitiesById, ...updates } };
    }),

  removeEntity: (poplogId) =>
    set((state) => {
      const next = { ...state.entitiesById };
      delete next[poplogId];
      return { entitiesById: next };
    }),

  clearEntities: () => set({ entitiesById: {} }),
}));

/** Hook de conveniência — lê uma entidade por poplogId. */
export function useEntity(poplogId: string | null | undefined): EntityData | undefined {
  return useEntitiesStore((state) =>
    poplogId ? state.entitiesById[poplogId] : undefined,
  );
}

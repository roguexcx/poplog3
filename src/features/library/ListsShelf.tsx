"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Library, ListPlus, Plus } from "lucide-react";

import type { ListsApiSuccess, UserListRecord, UserListSummary } from "@/types/lists";

import CreateListModal from "./CreateListModal";
import ListCollectionCard from "./ListCollectionCard";

type ListsShelfProps = {
  initialLists: UserListSummary[];
};

export default function ListsShelf({ initialLists }: ListsShelfProps) {
  const [lists, setLists] = useState(initialLists);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (reorderTimer.current) clearTimeout(reorderTimer.current);
  }, []);

  async function refreshLists() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/lists", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar suas listas.");
      setLists((payload as ListsApiSuccess<UserListSummary[]>).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar suas listas.");
    } finally {
      setLoading(false);
    }
  }

  function persistOrder(next: UserListSummary[]) {
    setLists(next);
    if (reorderTimer.current) clearTimeout(reorderTimer.current);
    reorderTimer.current = setTimeout(async () => {
      const response = await fetch("/api/lists/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderedIds: next.map((list) => list.id) }),
      });
      if (!response.ok) {
        setError("A nova ordem não pôde ser salva.");
        await refreshLists();
      }
    }, 350);
  }

  function moveList(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= lists.length) return;
    const next = [...lists];
    [next[index], next[target]] = [next[target], next[index]];
    persistOrder(next);
  }

  async function handleCreated(_list: UserListRecord) {
    await refreshLists();
  }

  return (
    <section className="relative h-full overflow-hidden rounded-[1.75rem] border border-indigo-400/[0.14] bg-gradient-to-br from-indigo-950/[0.30] to-transparent p-5 shadow-[inset_0_1px_0_rgba(120,130,255,0.06)] sm:p-6">
      <div className="pointer-events-none absolute -left-16 -top-12 h-48 w-48 rounded-full bg-indigo-500/[0.08] blur-[70px]" />

      <div className="relative flex h-full flex-col gap-3">
        {/* Cabeçalho compacto (espelha o RailHeader de Favoritos) */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Library className="h-3.5 w-3.5 text-indigo-300" />
              <h2 className="text-sm font-black uppercase tracking-wide text-white sm:text-[15px]">
                Suas Listas
              </h2>
            </div>
            <p className="mt-0.5 line-clamp-1 text-[11px] text-white/38">
              Coleções pessoais, sem alterar o estado da Biblioteca
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-indigo-200/25 bg-indigo-500/[0.12] px-3 text-[11px] font-black text-indigo-100 transition hover:border-indigo-200/40 hover:bg-indigo-500/[0.20]"
          >
            <Plus className="h-3.5 w-3.5" />
            Criar lista
          </button>
        </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-4 rounded-2xl border border-rose-300/18 bg-rose-500/[0.08] px-4 py-3 text-xs font-semibold text-rose-100/85">
          <span>{error}</span>
          <button type="button" onClick={refreshLists} className="shrink-0 font-black text-white hover:underline">
            Tentar novamente
          </button>
        </div>
      )}

      {loading && lists.length === 0 ? (
        <div className="flex gap-3 overflow-hidden" aria-label="Carregando listas">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-44 w-[230px] shrink-0 animate-pulse rounded-[1.45rem] border border-white/[0.06] bg-white/[0.035]" />
          ))}
        </div>
      ) : lists.length > 0 ? (
        <motion.ol
          layout
          className="flex gap-3 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Listas personalizadas"
        >
          {lists.map((list, index) => (
            <motion.li layout key={list.id} className="w-[230px] shrink-0 list-none sm:w-[250px]">
              <ListCollectionCard
                list={list}
                canMovePrevious={index > 0}
                canMoveNext={index < lists.length - 1}
                onMovePrevious={() => moveList(index, -1)}
                onMoveNext={() => moveList(index, 1)}
              />
            </motion.li>
          ))}

          <li className="w-[210px] shrink-0 list-none">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="group flex h-full min-h-44 w-full flex-col items-center justify-center rounded-[1.45rem] border border-dashed border-white/[0.12] bg-white/[0.018] px-6 text-center transition hover:border-indigo-200/30 hover:bg-indigo-500/[0.06]"
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/[0.10] bg-white/[0.04] text-indigo-200 transition group-hover:scale-105 group-hover:bg-indigo-500/[0.12]">
                <ListPlus className="h-5 w-5" />
              </span>
              <span className="mt-3 text-sm font-black text-white/72">Nova lista</span>
              <span className="mt-1 text-[11px] leading-5 text-white/34">Comece uma coleção</span>
            </button>
          </li>
        </motion.ol>
      ) : (
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="group flex min-h-36 w-full items-center gap-5 rounded-[1.5rem] border border-dashed border-white/[0.12] bg-white/[0.022] px-5 text-left transition hover:border-indigo-200/30 hover:bg-indigo-500/[0.055] sm:px-7"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/[0.10] bg-white/[0.045] text-indigo-200 transition group-hover:scale-105">
            <ListPlus className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-black text-white/82">Crie sua primeira lista</span>
            <span className="mt-1 block text-xs leading-5 text-white/38">Separe maratonas, favoritos temáticos ou qualquer coleção pessoal.</span>
          </span>
        </button>
      )}
      </div>

      <CreateListModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={handleCreated}
      />
    </section>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ArrowRight, Check, Layers3, ListPlus, Plus, X } from "lucide-react";

import ActionButton from "@/components/ui/ActionButton";
import CreateListModal from "@/features/library/CreateListModal";
import type {
  ListsApiSuccess,
  UserListRecord,
  UserListSummary,
} from "@/types/lists";

type AddToListPopoverProps = {
  tmdbId: number;
  poplogId?: string | number | null;
  imdbId?: string | null;
  slug?: string | null;
  mediaType: "movie" | "tv";
  currentLibraryStatus: string | null;
  onWatchlistAdded?: () => void;
};

export default function AddToListPopover({
  tmdbId,
  poplogId = null,
  imdbId = null,
  slug = null,
  mediaType,
  currentLibraryStatus,
  onWatchlistAdded,
}: AddToListPopoverProps) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [lists, setLists] = useState<UserListSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [alsoAddToWatchlist, setAlsoAddToWatchlist] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savedLists, setSavedLists] = useState<UserListSummary[]>([]);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const hasLibraryState = currentLibraryStatus !== null;

  function listHref(list: UserListSummary): string {
    return `/u/${encodeURIComponent(list.ownerUsername)}/listas/${list.shortId}-${list.slug}`;
  }

  useEffect(() => setMounted(true), []);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (tmdbId === 0) return;
    let cancelled = false;
    void fetchMembership().then((currentIds) => {
      if (cancelled) return;
      setExistingIds(currentIds);
      setSelectedIds(new Set(currentIds));
    }).catch(() => {
      // O modal exibirá o erro com contexto caso o usuário tente abri-lo.
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaType, tmdbId]);

  useEffect(() => {
    if (!open) return;
    setAlsoAddToWatchlist(true);
    setSuccess(null);
    setSavedLists([]);
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    void loadData();
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 40);

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !createOpen) setOpen(false);
    }

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
    // loadData intentionally runs once per open cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function fetchLists(): Promise<UserListSummary[]> {
    const response = await fetch("/api/lists", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar suas listas.");
    return (payload as ListsApiSuccess<UserListSummary[]>).data;
  }

  async function fetchMembership(): Promise<Set<string>> {
    if (tmdbId === 0) return new Set();
    const response = await fetch(
      `/api/lists/membership?titles=${encodeURIComponent(`${tmdbId}:${mediaType}`)}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? "Não foi possível ler as listas do título.");
    const membership = (payload as ListsApiSuccess<Record<string, string[]>>).data;
    return new Set(membership[`${tmdbId}:${mediaType}`] ?? []);
  }

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [nextLists, currentIds] = await Promise.all([
        fetchLists(),
        fetchMembership(),
      ]);
      setLists(nextLists);
      setExistingIds(currentIds);
      setSelectedIds(new Set(currentIds));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar suas listas.");
    } finally {
      setLoading(false);
    }
  }

  function toggleList(listId: string) {
    setSuccess(null);
    setSavedLists([]);
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  }

  async function handleCreated(list: UserListRecord) {
    const nextLists = await fetchLists();
    setLists(nextLists);
    setSelectedIds((current) => new Set([...current, list.id]));
  }

  async function handleSave() {
    const additions = [...selectedIds].filter((id) => !existingIds.has(id));
    const removals = [...existingIds].filter((id) => !selectedIds.has(id));
    if (additions.length === 0 && removals.length === 0) {
      setSuccess("Tudo já está atualizado.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    const identity = {
      ...(tmdbId !== 0 ? { tmdbId } : {}),
      poplogId,
      imdbId,
      slug,
      mediaType,
    };

    try {
      if (additions.length > 0) {
        const response = await fetch("/api/lists/items", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...identity,
            listIds: additions,
            alsoAddToWatchlist: hasLibraryState ? false : alsoAddToWatchlist,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível adicionar o título.");
        const result = (payload as ListsApiSuccess<{ addedToWatchlist: boolean }>).data;
        if (result.addedToWatchlist) onWatchlistAdded?.();
      }

      await Promise.all(removals.map(async (listId) => {
        const response = await fetch(`/api/lists/${listId}/items`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(identity),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível remover o título da lista.");
      }));

      const nextExisting = new Set(selectedIds);
      setExistingIds(nextExisting);
      setSavedLists(lists.filter((list) => nextExisting.has(list.id)));
      setSuccess("Listas atualizadas.");
      // Ação concluída: fecha automaticamente após uma breve confirmação,
      // tempo suficiente para o usuário ver/usar o atalho para a lista.
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setOpen(false), 1800);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar as listas.");
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <ActionButton
        variant="utility"
        size="md"
        active={existingIds.size > 0}
        leftIcon={<ListPlus className="h-4 w-4" />}
        onClick={() => setOpen(true)}
      >
        {existingIds.size > 0 ? `Em listas (${existingIds.size})` : "Adicionar à lista"}
      </ActionButton>

      {mounted && open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/72 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-5 sm:py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onMouseDown={() => !saving && setOpen(false)}
        >
          <div
            className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[1.75rem] border border-white/[0.11] bg-[#09090f] shadow-[0_28px_100px_rgba(0,0,0,0.72)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.12),transparent_45%)]" />
            <header className="relative flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200/55">Coleções</p>
                <h2 id={titleId} className="mt-1.5 text-xl font-black tracking-[-0.04em] text-white">Adicionar à lista</h2>
                <p className="mt-1.5 text-xs leading-5 text-white/42">Escolha uma ou mais listas pessoais.</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/[0.10] bg-white/[0.04] text-white/55 transition hover:bg-white/[0.09] hover:text-white disabled:opacity-40"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              {loading ? (
                <div className="space-y-2" aria-label="Carregando listas">
                  {[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-2xl bg-white/[0.045]" />)}
                </div>
              ) : lists.length > 0 ? (
                <div className="space-y-2">
                  {lists.map((list) => {
                    const checked = selectedIds.has(list.id);
                    return (
                      <label
                        key={list.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 transition ${checked ? "border-indigo-200/30 bg-indigo-500/[0.11]" : "border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.05]"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleList(list.id)}
                          className="sr-only"
                        />
                        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${checked ? "border-indigo-200/50 bg-indigo-300 text-indigo-950" : "border-white/20 bg-black/20 text-transparent"}`}>
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-white/82">{list.name}</span>
                          <span className="mt-0.5 block text-[11px] text-white/35">{list.itemCount} {list.itemCount === 1 ? "título" : "títulos"}</span>
                        </span>
                        {existingIds.has(list.id) && (
                          <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-white/42">Já está</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.025] px-5 py-8 text-center">
                  <Layers3 className="mx-auto h-6 w-6 text-white/24" />
                  <p className="mt-3 text-sm font-black text-white/72">Nenhuma lista ainda</p>
                  <p className="mt-1 text-xs leading-5 text-white/36">Crie uma coleção para guardar este título.</p>
                </div>
              )}

              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-indigo-200/20 bg-indigo-500/[0.055] text-xs font-black text-indigo-100/80 transition hover:border-indigo-200/35 hover:bg-indigo-500/[0.10] hover:text-indigo-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Criar nova lista
              </button>

              <label className={`mt-5 flex items-start gap-3 rounded-2xl border px-4 py-3.5 ${hasLibraryState ? "cursor-not-allowed border-white/[0.06] bg-white/[0.02] opacity-65" : "cursor-pointer border-white/[0.08] bg-white/[0.03]"}`}>
                <input
                  type="checkbox"
                  checked={hasLibraryState || alsoAddToWatchlist}
                  disabled={hasLibraryState}
                  onChange={(event) => setAlsoAddToWatchlist(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-indigo-300"
                />
                <span>
                  <span className="block text-xs font-bold text-white/75">Também adicionar à Watchlist</span>
                  <span className="mt-1 block text-[11px] leading-4 text-white/35">
                    {hasLibraryState ? "Seu estado atual na Biblioteca será preservado." : "Desmarque para manter o título somente nas listas escolhidas."}
                  </span>
                </span>
              </label>

              {error && <p role="alert" className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-500/[0.10] px-4 py-3 text-xs font-semibold text-rose-100">{error}</p>}
              {success && (
                <div role="status" className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-500/[0.10] px-4 py-3">
                  <p className="text-xs font-semibold text-emerald-100">{success}</p>
                  {savedLists.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {savedLists.map((list) => (
                        <Link
                          key={list.id}
                          href={listHref(list)}
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-200/25 bg-emerald-400/[0.10] px-2.5 py-1 text-[11px] font-black text-emerald-50 transition hover:bg-emerald-400/[0.18]"
                        >
                          {list.name}
                          <ArrowRight className="h-3 w-3" aria-hidden />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <footer className="relative flex items-center justify-end gap-2.5 border-t border-white/[0.07] px-5 py-4 sm:px-6">
              <button type="button" onClick={() => setOpen(false)} disabled={saving} className="h-10 rounded-full px-4 text-xs font-bold text-white/50 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40">Cancelar</button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || loading || lists.length === 0}
                className="inline-flex h-10 items-center justify-center rounded-full bg-white px-5 text-xs font-black text-zinc-950 transition hover:-translate-y-0.5 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </footer>
          </div>
        </div>,
        document.body,
      )}

      <CreateListModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={handleCreated}
      />
    </>
  );
}

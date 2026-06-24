"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Film, Plus, Search, Tv, X } from "lucide-react";

import TmdbImage from "@/components/images/TmdbImage";
import LocalizedTitle from "@/components/titles/LocalizedTitle";
import { getOriginalTitle, getReleaseYear, getTitle } from "@/lib/tmdb-utils";
import { useSearch } from "@/features/search/useSearch";
import type { TMDBItem } from "@/types/tmdb";

type AddTitlesToListModalProps = {
  open: boolean;
  listId: string;
  listName: string;
  /** Chaves `${tmdbId}:${mediaType}` já presentes na lista, para sinalizar duplicatas. */
  existingKeys: Set<string>;
  onClose: () => void;
  /** Disparado após adicionar com sucesso ao menos um título. */
  onAdded: () => void;
};

type SelectedTitle = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  poplogId: string | number | null;
  imdbId: string | null;
  slug: string | null;
  title: string;
};

function itemKey(item: TMDBItem): string {
  return `${item.id}:${item.media_type ?? "movie"}`;
}

export default function AddTitlesToListModal({
  open,
  listId,
  listName,
  existingKeys,
  onClose,
  onAdded,
}: AddTitlesToListModalProps) {
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Map<string, SelectedTitle>>(new Map());
  const [alsoAddToWatchlist, setAlsoAddToWatchlist] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const { results, loading } = useSearch(query);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(new Map());
    setAlsoAddToWatchlist(false);
    setError(null);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 60);

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visibleResults = useMemo(
    () => results.filter((item) => (item.media_type === "movie" || item.media_type === "tv") && item.id != null),
    [results],
  );

  function toggle(item: TMDBItem) {
    const key = itemKey(item);
    if (existingKeys.has(key)) return;
    setError(null);
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, {
          tmdbId: item.id,
          mediaType: (item.media_type as "movie" | "tv") ?? "movie",
          poplogId: item.poplogId ?? null,
          imdbId: item.externalIds?.imdbId ?? null,
          slug: item.externalIds?.slug ?? null,
          title: getTitle(item),
        });
      }
      return next;
    });
  }

  async function handleConfirm() {
    if (selected.size === 0) return;
    setSaving(true);
    setError(null);
    const titles = [...selected.values()];
    const failures: string[] = [];

    for (const title of titles) {
      try {
        const response = await fetch("/api/lists/items", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tmdbId: title.tmdbId,
            poplogId: title.poplogId,
            imdbId: title.imdbId,
            slug: title.slug,
            mediaType: title.mediaType,
            listIds: [listId],
            alsoAddToWatchlist,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error ?? "Falha ao adicionar.");
        }
      } catch {
        failures.push(title.title);
      }
    }

    setSaving(false);

    if (failures.length === titles.length) {
      setError("Não foi possível adicionar os títulos. Tente novamente.");
      return;
    }

    onAdded();
    if (failures.length > 0) {
      setError(`Alguns títulos não foram adicionados: ${failures.join(", ")}.`);
      setSelected(new Map());
      return;
    }
    onClose();
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/72 px-3 py-3 backdrop-blur-sm sm:items-center sm:px-5 sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={() => !saving && onClose()}
    >
      <div
        className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[1.75rem] border border-white/[0.11] bg-[#09090f] shadow-[0_28px_100px_rgba(0,0,0,0.72)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.12),transparent_45%)]" />

        <header className="relative flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200/55">Buscar títulos</p>
            <h2 id={titleId} className="mt-1.5 truncate text-xl font-black tracking-[-0.04em] text-white">Adicionar a “{listName}”</h2>
            <p className="mt-1.5 text-xs leading-5 text-white/42">Pesquise e selecione filmes e séries para incluir.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/[0.10] bg-white/[0.04] text-white/55 transition hover:bg-white/[0.09] hover:text-white disabled:opacity-40"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="relative border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/28" />
            <span className="sr-only">Buscar filmes e séries</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar filmes e séries…"
              className="h-11 w-full rounded-full border border-white/[0.08] bg-black/25 pl-10 pr-4 text-sm font-semibold text-white outline-none placeholder:text-white/25 focus:border-indigo-300/35"
            />
          </label>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {query.trim().length === 0 ? (
            <p className="py-8 text-center text-sm text-white/35">Comece a digitar para buscar títulos.</p>
          ) : loading && visibleResults.length === 0 ? (
            <div className="space-y-2" aria-label="Buscando">
              {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-2xl bg-white/[0.045]" />)}
            </div>
          ) : visibleResults.length === 0 ? (
            <p className="py-8 text-center text-sm text-white/35">Nenhum resultado para “{query.trim()}”.</p>
          ) : (
            <div className="space-y-2">
              {visibleResults.map((item) => {
                const key = itemKey(item);
                const type = (item.media_type as "movie" | "tv") ?? "movie";
                const already = existingKeys.has(key);
                const checked = selected.has(key);
                const year = getReleaseYear(item);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggle(item)}
                    disabled={already}
                    aria-pressed={checked}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition ${
                      already
                        ? "cursor-not-allowed border-white/[0.05] bg-white/[0.02] opacity-55"
                        : checked
                          ? "border-indigo-200/30 bg-indigo-500/[0.11]"
                          : "border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.05]"
                    }`}
                  >
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${checked ? "border-indigo-200/50 bg-indigo-300 text-indigo-950" : "border-white/20 bg-black/20 text-transparent"}`}>
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="relative h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                      <TmdbImage
                        path={item.poster_path ?? null}
                        kind="poster"
                        size="card"
                        alt=""
                        fill
                        sizes="40px"
                        className="object-cover opacity-90"
                        fallback={<div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">—</div>}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <LocalizedTitle as="h3" title={getTitle(item)} originalTitle={getOriginalTitle(item)} variant="compact" />
                      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-white/35">
                        {type === "movie" ? <Film className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                        {type === "movie" ? "Filme" : "Série"}
                        {year !== "----" ? ` · ${year}` : ""}
                      </span>
                    </span>
                    {already && (
                      <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-white/42">Já está</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {error && <p role="alert" className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-500/[0.10] px-4 py-3 text-xs font-semibold text-rose-100">{error}</p>}
        </div>

        <footer className="relative flex items-center justify-between gap-3 border-t border-white/[0.07] px-5 py-4 sm:px-6">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] font-bold text-white/55">
            <input
              type="checkbox"
              checked={alsoAddToWatchlist}
              onChange={(event) => setAlsoAddToWatchlist(event.target.checked)}
              className="h-4 w-4 accent-indigo-300"
            />
            Também na Watchlist
          </label>
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onClose} disabled={saving} className="h-10 rounded-full px-4 text-xs font-bold text-white/50 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40">Cancelar</button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving || selected.size === 0}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full bg-white px-5 text-xs font-black text-zinc-950 transition hover:-translate-y-0.5 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Plus className="h-3.5 w-3.5" />
              {saving ? "Adicionando…" : selected.size > 0 ? `Adicionar (${selected.size})` : "Adicionar"}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

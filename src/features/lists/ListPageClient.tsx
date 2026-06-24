"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Reorder, useDragControls } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Edit3,
  Film,
  GripVertical,
  ListFilter,
  Plus,
  Search,
  Trash2,
  Tv,
  X,
} from "lucide-react";

import PosterCard from "@/components/ui/PosterCard";
import EmptyState from "@/components/ui/EmptyState";
import { TmdbImageLegacy as TmdbImage } from "@/components/images/TmdbImage";
import CreateListModal from "@/features/library/CreateListModal";
import type { ListsApiSuccess, UserListDetail, UserListRecord, UserListTitleItem } from "@/types/lists";

import AddTitlesToListModal from "./AddTitlesToListModal";
import DeleteListModal from "./DeleteListModal";

type MediaFilter = "all" | "movie" | "tv";
type DurationFilter = "all" | "short" | "medium" | "long";
type SortMode = "manual" | "release-desc" | "release-asc" | "runtime-desc" | "runtime-asc" | "title-asc";

const DURATION_OPTIONS: { value: DurationFilter; label: string }[] = [
  { value: "all", label: "Qualquer duração" },
  { value: "short", label: "Até 60 min" },
  { value: "medium", label: "60–120 min" },
  { value: "long", label: "Mais de 120 min" },
];

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "manual", label: "Ordem manual" },
  { value: "release-desc", label: "Lançamento (+ novo)" },
  { value: "release-asc", label: "Lançamento (+ antigo)" },
  { value: "runtime-desc", label: "Duração (+ longo)" },
  { value: "runtime-asc", label: "Duração (+ curto)" },
  { value: "title-asc", label: "Nome (A–Z)" },
];

function matchesDuration(runtime: number | null, filter: DurationFilter): boolean {
  if (filter === "all") return true;
  if (runtime === null) return false;
  if (filter === "short") return runtime <= 60;
  if (filter === "medium") return runtime > 60 && runtime <= 120;
  return runtime > 120;
}

function compareItems(a: UserListTitleItem, b: UserListTitleItem, sort: SortMode): number {
  switch (sort) {
    case "release-desc":
    case "release-asc": {
      const aTime = a.releaseDate ? Date.parse(a.releaseDate) : (a.year ? Date.parse(`${a.year}-01-01`) : NaN);
      const bTime = b.releaseDate ? Date.parse(b.releaseDate) : (b.year ? Date.parse(`${b.year}-01-01`) : NaN);
      const aValid = Number.isFinite(aTime);
      const bValid = Number.isFinite(bTime);
      if (!aValid && !bValid) return 0;
      if (!aValid) return 1; // sem data vai para o fim
      if (!bValid) return -1;
      return sort === "release-desc" ? bTime - aTime : aTime - bTime;
    }
    case "runtime-desc":
    case "runtime-asc": {
      const aValid = a.runtime !== null;
      const bValid = b.runtime !== null;
      if (!aValid && !bValid) return 0;
      if (!aValid) return 1;
      if (!bValid) return -1;
      return sort === "runtime-desc" ? b.runtime! - a.runtime! : a.runtime! - b.runtime!;
    }
    case "title-asc":
      return a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" });
    default:
      return 0;
  }
}

type ListPageClientProps = {
  initialDetail: UserListDetail;
};

type OrderableListItemProps = {
  item: UserListTitleItem;
  index: number;
  itemCount: number;
  onMove: (index: number, direction: -1 | 1) => void;
};

function OrderableListItem({ item, index, itemCount, onMove }: OrderableListItemProps) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item value={item} dragListener={false} dragControls={dragControls} className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#0b0b11]/95 p-2.5 shadow-lg">
      <button type="button" onPointerDown={(event) => dragControls.start(event)} className="grid h-9 w-8 shrink-0 cursor-grab place-items-center rounded-lg text-white/22 transition hover:bg-white/[0.06] hover:text-white/55 active:cursor-grabbing" aria-label={`Arrastar ${item.title} para reordenar`}>
        <GripVertical className="h-5 w-5" aria-hidden />
      </button>
      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
        <TmdbImage
          path={item.posterPath}
          fallbackPath={item.backdropPath}
          size="w300"
          alt=""
          fallbackLabel=""
          className="h-full w-full object-cover"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-white/82">{item.title}</p>
        <p className="mt-1 text-[11px] text-white/34">{item.mediaType === "movie" ? "Filme" : "Série"}{item.year ? ` · ${item.year}` : ""}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} className="grid h-8 w-8 place-items-center rounded-full text-white/45 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-15" aria-label={`Mover ${item.title} para cima`}><ArrowUp className="h-4 w-4" /></button>
        <button type="button" onClick={() => onMove(index, 1)} disabled={index === itemCount - 1} className="grid h-8 w-8 place-items-center rounded-full text-white/45 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-15" aria-label={`Mover ${item.title} para baixo`}><ArrowDown className="h-4 w-4" /></button>
      </div>
    </Reorder.Item>
  );
}

type ListFilterSelectProps = {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  highlight?: boolean;
};

function ListFilterSelect({ label, value, options, onChange, highlight = false }: ListFilterSelectProps) {
  const isDefault = options[0]?.value === value;
  return (
    <div className="relative flex items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/30">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{ colorScheme: "dark" }}
          aria-label={label}
          className={`appearance-none rounded-full border bg-transparent py-1 pl-2.5 pr-6 text-[11px] font-bold outline-none transition [&_option]:bg-[#0d0d14] [&_option]:text-white ${
            highlight && !isDefault
              ? "border-indigo-400/30 bg-indigo-500/[0.12] text-indigo-100"
              : "border-white/[0.10] text-white/65 hover:border-white/[0.18] hover:text-white"
          }`}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-white/35" />
      </div>
    </div>
  );
}

export default function ListPageClient({ initialDetail }: ListPageClientProps) {
  const router = useRouter();
  const [list, setList] = useState(initialDetail.list);
  const [items, setItems] = useState(initialDetail.items);
  const [query, setQuery] = useState("");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [orderSaving, setOrderSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (reorderTimer.current) clearTimeout(reorderTimer.current);
  }, []);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    items.forEach((item) => {
      if (typeof item.year === "number" && item.year > 1900) years.add(item.year);
    });
    return [...years].sort((a, b) => b - a);
  }, [items]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    const filtered = items.filter((item) => {
      if (mediaFilter !== "all" && item.mediaType !== mediaFilter) return false;
      if (yearFilter !== null && item.year !== yearFilter) return false;
      if (!matchesDuration(item.runtime, durationFilter)) return false;
      if (!normalizedQuery) return true;
      return [item.title, item.originalTitle]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("pt-BR").includes(normalizedQuery));
    });
    // A ordenação é apenas uma visão temporária; "Ordem manual" preserva a ordem salva.
    return sortMode === "manual" ? filtered : [...filtered].sort((a, b) => compareItems(a, b, sortMode));
  }, [items, mediaFilter, yearFilter, durationFilter, sortMode, query]);

  const existingKeys = useMemo(
    () => new Set(items.map((item) => `${item.tmdbId}:${item.mediaType}`)),
    [items],
  );

  async function refreshItems() {
    try {
      const response = await fetch(`/api/lists/${list.id}/items`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload = (await response.json()) as ListsApiSuccess<UserListDetail>;
      setItems(payload.data.items);
      setList(payload.data.list);
    } catch {
      // Em caso de falha de refetch, recarrega a rota para refletir o estado salvo.
      router.refresh();
    }
  }

  const hasFilters =
    query.trim().length > 0 ||
    mediaFilter !== "all" ||
    yearFilter !== null ||
    durationFilter !== "all" ||
    sortMode !== "manual";

  function clearFilters() {
    setQuery("");
    setMediaFilter("all");
    setYearFilter(null);
    setDurationFilter("all");
    setSortMode("manual");
  }
  async function saveOrder(next: UserListTitleItem[]) {
    setOrderSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/lists/${list.id}/items/reorder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderedItemIds: next.map((item) => item.id) }),
      });
      if (!response.ok) {
        throw new Error("A nova ordem não pôde ser salva. Recarregue a página e tente novamente.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "A nova ordem não pôde ser salva.");
      throw caught;
    } finally {
      setOrderSaving(false);
    }
  }

  function persistOrder(next: UserListTitleItem[]) {
    setItems(next);
    if (reorderTimer.current) clearTimeout(reorderTimer.current);
    reorderTimer.current = setTimeout(() => {
      void saveOrder(next).catch(() => undefined);
    }, 350);
  }

  async function finishOrdering() {
    if (reorderTimer.current) {
      clearTimeout(reorderTimer.current);
      reorderTimer.current = null;
    }
    try {
      await saveOrder(items);
      setOrdering(false);
    } catch {
      // O alerta mantém o usuário no modo de ordenação para tentar novamente.
    }
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    persistOrder(next);
  }

  async function removeItem(item: UserListTitleItem) {
    setRemovingId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/lists/${list.id}/items`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tmdbId: item.tmdbId, mediaType: item.mediaType }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível remover o título.");
      setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      setList((current) => ({
        ...current,
        itemCount: Math.max(0, current.itemCount - 1),
        covers: current.covers.filter((cover) => cover.id !== item.id),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível remover o título.");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleSaved(record: UserListRecord) {
    const updated = { ...list, ...record };
    setList(updated);
    router.replace(`/u/${encodeURIComponent(updated.ownerUsername)}/listas/${updated.shortId}-${updated.slug}`);
    router.refresh();
  }

  async function deleteList() {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/lists/${list.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível excluir a lista.");
      router.push("/library");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível excluir a lista.");
      setDeleting(false);
    }
  }

  function startOrdering() {
    // A reordenação manual opera sobre a ordem real; limpa qualquer filtro/ordenação temporária.
    if (hasFilters) clearFilters();
    setOrdering(true);
  }

  return (
    <div className="relative pb-20">
      <div className="pointer-events-none absolute -left-36 top-10 h-96 w-96 rounded-full bg-indigo-700/[0.08] blur-[110px]" />
      <div className="pointer-events-none absolute -right-24 top-72 h-80 w-80 rounded-full bg-cyan-700/[0.05] blur-[100px]" />

      <header className="relative overflow-hidden rounded-[2rem] border border-white/[0.08] bg-gradient-to-br from-indigo-950/45 via-zinc-950/75 to-black px-5 py-7 shadow-[0_24px_80px_rgba(0,0,0,0.38)] sm:px-8 sm:py-9">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(34,211,238,0.10),transparent_38%)]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-indigo-200/60">Lista privada</p>
            <h1 className="mt-3 text-3xl font-black tracking-[-0.055em] text-white sm:text-4xl md:text-5xl">{list.name}</h1>
            {list.description && <p className="mt-4 max-w-2xl text-sm leading-7 text-white/48 sm:text-base">{list.description}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold text-white/40">
              <span className="rounded-full border border-white/[0.09] bg-white/[0.04] px-3 py-1.5">{list.itemCount} {list.itemCount === 1 ? "título" : "títulos"}</span>
              <span className="rounded-full border border-white/[0.09] bg-white/[0.04] px-3 py-1.5">Somente você</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAddOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-full border border-white/[0.14] bg-white px-4 text-xs font-black text-zinc-950 transition hover:-translate-y-0.5 hover:bg-indigo-100">
              <Plus className="h-3.5 w-3.5" />
              Adicionar títulos
            </button>
            <button type="button" onClick={() => setEditing(true)} className="inline-flex h-10 items-center gap-2 rounded-full border border-white/[0.11] bg-white/[0.05] px-4 text-xs font-black text-white/70 transition hover:bg-white/[0.09] hover:text-white">
              <Edit3 className="h-3.5 w-3.5" />
              Editar
            </button>
            {items.length > 1 && (
              <button type="button" onClick={ordering ? finishOrdering : startOrdering} disabled={orderSaving} className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-xs font-black transition disabled:cursor-wait disabled:opacity-55 ${ordering ? "border-cyan-200/35 bg-cyan-500/[0.14] text-cyan-50" : "border-white/[0.11] bg-white/[0.05] text-white/70 hover:bg-white/[0.09] hover:text-white"}`}>
                <GripVertical className="h-3.5 w-3.5" />
                {ordering ? (orderSaving ? "Salvando…" : "Concluir ordem") : "Ordenar"}
              </button>
            )}
            <button type="button" onClick={() => setDeleteOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-full border border-rose-300/[0.14] bg-rose-500/[0.06] px-4 text-xs font-black text-rose-100/68 transition hover:border-rose-300/25 hover:bg-rose-500/[0.12] hover:text-rose-50">
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div role="alert" className="relative mt-5 flex items-start justify-between gap-4 rounded-2xl border border-rose-300/18 bg-rose-500/[0.09] px-4 py-3 text-sm font-semibold text-rose-100">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Fechar erro" className="shrink-0 text-rose-100/60 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
      )}

      {ordering ? (
        <section className="relative mt-8">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200/60">Ordem manual</p>
            <h2 className="mt-1 text-xl font-black tracking-[-0.035em] text-white">Arraste para reorganizar</h2>
            <p className="mt-1 text-xs leading-5 text-white/38">A ordem é salva automaticamente. Os botões também funcionam pelo teclado.</p>
          </div>
          <Reorder.Group axis="y" values={items} onReorder={persistOrder} className="space-y-2" aria-label="Títulos reordenáveis">
            {items.map((item, index) => (
              <OrderableListItem key={item.id} item={item} index={index} itemCount={items.length} onMove={moveItem} />
            ))}
          </Reorder.Group>
        </section>
      ) : (
        <section className="relative mt-8">
          {items.length > 0 && (
            <div className="mb-6 flex flex-col gap-3 rounded-[1.35rem] border border-white/[0.07] bg-white/[0.025] p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/28" />
                  <span className="sr-only">Buscar nesta lista</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nesta lista" className="h-10 w-full rounded-full border border-white/[0.08] bg-black/20 pl-10 pr-4 text-xs font-semibold text-white outline-none placeholder:text-white/25 focus:border-indigo-300/35" />
                </label>
                <div className="flex gap-1.5" aria-label="Filtrar por tipo">
                  {([
                    { id: "all", label: "Tudo", icon: ListFilter },
                    { id: "movie", label: "Filmes", icon: Film },
                    { id: "tv", label: "Séries", icon: Tv },
                  ] as const).map((option) => {
                    const Icon = option.icon;
                    return <button key={option.id} type="button" onClick={() => setMediaFilter(option.id)} className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-black transition ${mediaFilter === option.id ? "border-indigo-200/30 bg-indigo-500/[0.14] text-indigo-50" : "border-white/[0.07] bg-white/[0.025] text-white/45 hover:text-white"}`} aria-pressed={mediaFilter === option.id}><Icon className="h-3.5 w-3.5" />{option.label}</button>;
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3">
                {availableYears.length > 1 && (
                  <ListFilterSelect
                    label="Ano"
                    value={yearFilter?.toString() ?? "all"}
                    options={[{ value: "all", label: "Todos" }, ...availableYears.map((year) => ({ value: year.toString(), label: year.toString() }))]}
                    onChange={(value) => setYearFilter(value === "all" ? null : Number.parseInt(value, 10))}
                  />
                )}
                <ListFilterSelect
                  label="Duração"
                  value={durationFilter}
                  options={DURATION_OPTIONS}
                  onChange={(value) => setDurationFilter(value as DurationFilter)}
                />
                <ListFilterSelect
                  label="Ordenar"
                  value={sortMode}
                  options={SORT_OPTIONS}
                  onChange={(value) => setSortMode(value as SortMode)}
                  highlight
                />
                {hasFilters && (
                  <button type="button" onClick={clearFilters} className="ml-auto rounded-full border border-white/[0.08] px-3 py-1 text-[11px] font-bold text-white/40 transition hover:border-white/[0.18] hover:text-white/70">
                    Limpar filtros
                  </button>
                )}
              </div>

              {sortMode !== "manual" && (
                <p className="text-[11px] leading-4 text-white/35">
                  Visualização temporária — a ordem manual da lista não é alterada.
                </p>
              )}
            </div>
          )}

          {visibleItems.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-4">
              {visibleItems.map((item, index) => (
                <div key={item.id} className="relative">
                  <PosterCard posterPath={item.posterPath} fallbackPath={item.backdropPath} title={item.title} originalTitle={item.originalTitle} mediaType={item.mediaType} year={item.year} href={item.href} priority={index < 8} />
                  <button
                    type="button"
                    onClick={() => removeItem(item)}
                    disabled={removingId === item.id}
                    className="absolute right-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-full border border-white/[0.12] bg-black/72 text-white/55 shadow-lg backdrop-blur-md transition hover:border-rose-300/30 hover:bg-rose-500/25 hover:text-rose-50 disabled:cursor-wait disabled:opacity-45 sm:right-3 sm:top-3"
                    aria-label={`Remover ${item.title} desta lista`}
                    title="Remover desta lista"
                  >
                    {removingId === item.id ? <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" /> : <X className="h-4 w-4" />}
                  </button>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon="◇"
              kicker="Lista vazia"
              title="Sua coleção começa no próximo título."
              description="Busque um filme ou série e adicione direto a esta lista."
              action={<button type="button" onClick={() => setAddOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-black text-zinc-950"><Plus className="h-4 w-4" />Adicionar títulos</button>}
            />
          ) : (
            <EmptyState
              icon="⌕"
              kicker="Sem resultados"
              title="Nenhum título combina com os filtros."
              description="Tente outro termo ou ajuste os filtros aplicados."
              action={<button type="button" onClick={clearFilters} className="h-10 rounded-full border border-white/[0.12] bg-white/[0.05] px-5 text-xs font-black text-white">Limpar filtros</button>}
            />
          )}
        </section>
      )}

      <AddTitlesToListModal
        open={addOpen}
        listId={list.id}
        listName={list.name}
        existingKeys={existingKeys}
        onClose={() => setAddOpen(false)}
        onAdded={refreshItems}
      />
      <CreateListModal open={editing} list={list} onClose={() => setEditing(false)} onSaved={handleSaved} />
      <DeleteListModal open={deleteOpen} listName={list.name} deleting={deleting} error={deleteOpen ? error : null} onClose={() => !deleting && setDeleteOpen(false)} onConfirm={deleteList} />

    </div>
  );
}

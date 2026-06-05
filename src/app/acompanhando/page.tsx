"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import PageShell from "@/components/layout/PageShell";
import HeroSpotlight from "@/components/HeroSpotlight";
import SectionHeader from "@/components/ui/SectionHeader";
import NewEpisodeCard, {
  type NewEpisodeItem,
} from "@/features/acompanhando/NewEpisodeCard";
import ContinueCard, {
  type ContinueItem,
} from "@/features/acompanhando/ContinueCard";
import WatchlistPickCard, {
  type WatchlistPickItem,
} from "@/features/acompanhando/WatchlistPickCard";
import StartSeriesBanner from "@/features/acompanhando/StartSeriesBanner";
import RecentlyWatchedCard, {
  type RecentlyWatchedItem,
} from "@/features/acompanhando/RecentlyWatchedCard";

import type { ScoredItem, SignalType } from "@/components/HeroSpotlight/types";

type ContinueSortMode = "recent" | "season" | "series";

function getMediaType(item: ScoredItem) {
  return item.content_type === "filme" ? "movie" : "tv";
}

function getTmdbId(item: ScoredItem) {
  const source = item as ScoredItem & {
    tmdbId?: number | string | null;
    content_id?: number | string | null;
    id?: number | string | null;
  };

  const raw = source.tmdbId ?? source.content_id ?? source.id ?? "";
  const str = String(raw);
  // Preserve sign for synthetic negative IDs (e.g. -137523); only strip for "tv-1396" patterns
  const n = Number(str);
  if (Number.isInteger(n) && n !== 0) return str;
  return str.replace(/\D/g, "");
}

async function postCuradoriaAction(body: unknown) {
  await fetch("/api/poplog3/acompanhando", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; reason: string };

async function fetchJsonSafe<T>(url: string): Promise<FetchResult<T>> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn("[AcompanhandoPage] fetch network error:", { url, reason });
    return { ok: false, status: null, reason };
  }

  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    console.warn("[AcompanhandoPage] resposta não-ok:", {
      url,
      status: res.status,
      contentType,
    });
    // Tenta extrair mensagem de erro do JSON, se disponível
    const reason = contentType.includes("application/json")
      ? await res.json().then((d: unknown) => (d && typeof d === "object" && "error" in d ? String((d as Record<string, unknown>).error) : `HTTP ${res.status}`)).catch(() => `HTTP ${res.status}`)
      : `HTTP ${res.status}`;
    return { ok: false, status: res.status, reason };
  }

  if (!contentType.includes("application/json")) {
    console.warn("[AcompanhandoPage] content-type inesperado:", {
      url,
      status: res.status,
      contentType,
    });
    return { ok: false, status: res.status, reason: "Resposta não é JSON" };
  }

  try {
    const data = await res.json() as T;
    return { ok: true, data };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "JSON inválido";
    console.warn("[AcompanhandoPage] erro ao parsear JSON:", { url, reason });
    return { ok: false, status: res.status, reason };
  }
}

/** Mantido para chamadas internas que não precisam do estado de erro. */
async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  const result = await fetchJsonSafe<T>(url);
  return result.ok ? result.data : null;
}

// ── Hook responsivo para itens por página da seção Continue ──────────────────
function useContinueItemsPerPage() {
  const [itemsPerPage, setItemsPerPage] = useState(9);

  useEffect(() => {
    function update() {
      if (window.innerWidth < 768)  { setItemsPerPage(4); return; }
      if (window.innerWidth < 1280) { setItemsPerPage(6); return; }
      setItemsPerPage(9);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return itemsPerPage;
}

// ── Paginação compacta para blocos internos ───────────────────────────────────
function SectionPagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages = getSectionPaginationPages(page, totalPages);

  return (
    <div className="flex items-center justify-center gap-1.5 pt-2">
      <button
        type="button"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        className="h-8 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-black text-white/45 transition hover:border-white/[0.15] hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
      >
        ‹
      </button>

      {pages.map((item, index) =>
        item === "gap" ? (
          <span key={`gap-${index}`} className="px-1 text-xs text-white/22">…</span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item)}
            className={[
              "h-8 min-w-8 rounded-full border px-2.5 text-xs font-black transition",
              item === page
                ? "border-indigo-300/28 bg-indigo-400/[0.14] text-indigo-50 shadow-[0_0_16px_rgba(99,102,241,0.16)]"
                : "border-white/[0.07] bg-white/[0.025] text-white/38 hover:border-white/[0.14] hover:text-white",
            ].join(" ")}
          >
            {item}
          </button>
        ),
      )}

      <button
        type="button"
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
        className="h-8 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-black text-white/45 transition hover:border-white/[0.15] hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
      >
        ›
      </button>
    </div>
  );
}

function getSectionPaginationPages(page: number, total: number): Array<number | "gap"> {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const set    = new Set([1, total, page - 1, page, page + 1]);
  const sorted = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("gap");
    result.push(sorted[i]);
  }
  return result;
}

export default function AcompanhandoPage() {
  const router = useRouter();

  const [heroItems, setHeroItems] = useState<ScoredItem[]>([]);
  const [isHeroLoading, setIsHeroLoading] = useState(true);
  const [, setHeroError] = useState<string | null>(null);

  const [newEpisodeItems, setNewEpisodeItems] = useState<NewEpisodeItem[]>([]);
  const [isNewEpisodesLoading, setIsNewEpisodesLoading] = useState(true);
  const [newEpisodesError, setNewEpisodesError] = useState<string | null>(null);

  const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);
  const [isContinueLoading, setIsContinueLoading] = useState(true);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [continueSortMode, setContinueSortMode] = useState<ContinueSortMode>("series");
  const [continuePage, setContinuePage] = useState(1);
  const continueItemsPerPage = useContinueItemsPerPage();

  const [recentlyWatched, setRecentlyWatched] = useState<RecentlyWatchedItem[]>([]);
  const [isRecentlyWatchedLoading, setIsRecentlyWatchedLoading] = useState(true);

  const [watchlistPicks, setWatchlistPicks] = useState<WatchlistPickItem[]>([]);
  const [isWatchlistPicksLoading, setIsWatchlistPicksLoading] = useState(true);
  const [startSeriesPicks, setStartSeriesPicks] = useState<WatchlistPickItem[]>([]);
  const [isStartSeriesLoading, setIsStartSeriesLoading] = useState(true);
  // IDs já exibidos na sessão — usados para cooldown de refresh
  const shownWatchlistIds = useRef<Set<string>>(new Set());
  const shownStartSeriesIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetchJsonSafe<{ candidates?: ScoredItem[] }>("/api/poplog3/continuity/hero")
      .then((result) => {
        if (result.ok) {
          if (Array.isArray(result.data.candidates)) {
            setHeroItems(result.data.candidates);
          }
        } else {
          // 404 = sem dados (sem candidatos ou usuário novo) → não é um erro fatal.
          // 5xx = falha real no servidor → loga como erro.
          const isFatal = result.status !== null && result.status >= 500;
          if (isFatal) {
            setHeroError(result.reason);
            console.error("[AcompanhandoPage] Hero falhou (erro servidor):", result.reason);
          } else {
            // Ausência de candidatos é esperada; exibe fallback silenciosamente.
            console.warn("[AcompanhandoPage] Hero sem candidatos:", { status: result.status, reason: result.reason });
          }
        }
      })
      .catch((err) => {
        setHeroError(err instanceof Error ? err.message : String(err));
        console.error("[AcompanhandoPage] Falha ao carregar Hero:", err);
      })
      .finally(() => {
        setIsHeroLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchJsonSafe<{ items?: NewEpisodeItem[] }>("/api/poplog3/continuity/new-episodes")
      .then((result) => {
        if (result.ok) {
          if (Array.isArray(result.data.items)) {
            setNewEpisodeItems(result.data.items);
          }
        } else {
          setNewEpisodesError(result.reason);
          console.error("[AcompanhandoPage] Novos episódios falhou:", result.reason);
        }
      })
      .catch((err) => {
        setNewEpisodesError(err instanceof Error ? err.message : String(err));
        console.error("[AcompanhandoPage] Falha ao carregar novos episódios:", err);
      })
      .finally(() => {
        setIsNewEpisodesLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchJsonSafe<{ items?: ContinueItem[] }>("/api/poplog3/continuity/continue")
      .then((result) => {
        if (result.ok) {
          if (Array.isArray(result.data.items)) {
            setContinueItems(result.data.items);
          }
        } else {
          setContinueError(result.reason);
          console.error("[AcompanhandoPage] Continue falhou:", result.reason);
        }
      })
      .catch((err) => {
        setContinueError(err instanceof Error ? err.message : String(err));
        console.error("[AcompanhandoPage] Falha ao carregar continuidade:", err);
      })
      .finally(() => {
        setIsContinueLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchJsonSafe<{ items?: RecentlyWatchedItem[] }>("/api/poplog3/continuity/recently-watched")
      .then((result) => {
        if (result.ok && Array.isArray(result.data.items)) {
          setRecentlyWatched(result.data.items);
        }
      })
      .catch((err) => {
        console.error("[AcompanhandoPage] Falha ao carregar últimos assistidos:", err);
      })
      .finally(() => {
        setIsRecentlyWatchedLoading(false);
      });
  }, []);

  const fetchWatchlistPicks = useCallback((excludeIds: string[] = []) => {
    setIsWatchlistPicksLoading(true);
    const allExcludeIds = Array.from(
      new Set([...excludeIds, ...Array.from(shownStartSeriesIds.current)]),
    );
    const params = allExcludeIds.length
      ? `?exclude=${allExcludeIds.join(",")}`
      : "";
    fetchJsonOrNull<{ items?: WatchlistPickItem[] }>(`/api/poplog3/continuity/watchlist-picks${params}`)
      .then((data) => {
        if (data && Array.isArray(data.items)) {
          setWatchlistPicks(data.items);
          // Acumula IDs exibidos para cooldown do próximo refresh
          data.items.forEach((item: WatchlistPickItem) =>
            shownWatchlistIds.current.add(item.content_id),
          );
        }
      })
      .catch((err) => {
        console.error("[AcompanhandoPage] Falha ao carregar watchlist picks:", err);
      })
      .finally(() => {
        setIsWatchlistPicksLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!isStartSeriesLoading) {
      Promise.resolve().then(() => fetchWatchlistPicks());
    }
  }, [fetchWatchlistPicks, isStartSeriesLoading]);

  const fetchStartSeriesPicks = useCallback((excludeIds: string[] = []) => {
    setIsStartSeriesLoading(true);
    const params = new URLSearchParams({ seriesStart: "1" });
    if (excludeIds.length) params.set("exclude", excludeIds.join(","));

    fetchJsonOrNull<{ items?: WatchlistPickItem[] }>(`/api/poplog3/continuity/watchlist-picks?${params.toString()}`)
      .then((data) => {
        if (data && Array.isArray(data.items)) {
          setStartSeriesPicks(data.items);
          data.items.forEach((item: WatchlistPickItem) =>
            shownStartSeriesIds.current.add(item.content_id),
          );
        }
      })
      .catch((err) => {
        console.error("[AcompanhandoPage] Falha ao carregar séries para começar:", err);
      })
      .finally(() => {
        setIsStartSeriesLoading(false);
      });
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => fetchStartSeriesPicks());
  }, [fetchStartSeriesPicks]);

  const refreshWatchlistPicks = useCallback(() => {
    // Passa os IDs atualmente exibidos como "cooldown"
    const excludeIds = Array.from(shownWatchlistIds.current);
    fetchWatchlistPicks(excludeIds);
  }, [fetchWatchlistPicks]);

  const refreshStartSeriesPicks = useCallback(() => {
    const excludeIds = Array.from(shownStartSeriesIds.current);
    fetchStartSeriesPicks(excludeIds);
  }, [fetchStartSeriesPicks]);

  const snoozeItem = useCallback(
    async (contentId: string, durationHours = 4) => {
      const snoozedUntil = new Date(
        Date.now() + durationHours * 3_600_000,
      ).toISOString();
      await postCuradoriaAction({
        action: "snooze",
        content_id: contentId,
        snoozed_until: snoozedUntil,
      });
    },
    [],
  );

  const logSignal = useCallback(
    async (contentId: string, signal: SignalType, value?: object) => {
      await postCuradoriaAction({
        action: "signal",
        content_id: contentId,
        signal,
        value,
      });
    },
    [],
  );

  function handleNavigate(item: ScoredItem) {
    router.push(`/title/${getMediaType(item)}/${getTmdbId(item)}`);
  }

  function handleNewEpisodeNavigate(item: NewEpisodeItem) {
    router.push(`/title/tv/${item.tmdb_id}`);
  }

  function handleContinueNavigate(item: ContinueItem) {
    router.push(`/title/tv/${item.tmdb_id}`);
  }

  function handleWatchlistPickNavigate(item: WatchlistPickItem) {
    router.push(`/title/${item.media_type}/${item.tmdb_id}`);
  }

  function handleStartSeriesNavigate(item: WatchlistPickItem) {
    router.push(`/title/tv/${item.tmdb_id}`);
  }

  function handleRecentlyWatchedNavigate(item: RecentlyWatchedItem) {
    router.push(`/title/${item.media_type}/${item.tmdb_id}`);
  }

  const sortedContinueItems = useMemo(() => {
    if (continueSortMode === "season") {
      return [...continueItems].sort((a, b) => {
        const aMinutes = a.remaining_minutes;
        const bMinutes = b.remaining_minutes;

        // "Mais fáceis": menor tempo para terminar a temporada atual do título.
        if (aMinutes != null && bMinutes != null) {
          return (
            aMinutes - bMinutes ||
            a.episodes_behind - b.episodes_behind ||
            (b.last_watched_at ?? "").localeCompare(a.last_watched_at ?? "")
          );
        }

        // Fallback: episódios restantes — confiável mesmo sem runtime no banco.
        return (
          a.episodes_behind - b.episodes_behind ||
          (b.last_watched_at ?? "").localeCompare(a.last_watched_at ?? "")
        );
      });
    }

    if (continueSortMode === "series") {
      return [...continueItems].sort((a, b) => {
        const aMinutes = a.series_remaining_minutes;
        const bMinutes = b.series_remaining_minutes;

        // "Ficar em dia": menor tempo total pendente da série inteira.
        if (aMinutes != null && bMinutes != null) {
          return (
            aMinutes - bMinutes ||
            a.episodes_behind - b.episodes_behind ||
            (b.last_watched_at ?? "").localeCompare(a.last_watched_at ?? "")
          );
        }

        return (
          a.episodes_behind - b.episodes_behind ||
          (b.last_watched_at ?? "").localeCompare(a.last_watched_at ?? "")
        );
      });
    }

    // "recent": já vem ordenado por last_watched_at DESC do servidor
    return continueItems;
  }, [continueItems, continueSortMode]);

  const continueTotalPages = Math.max(1, Math.ceil(sortedContinueItems.length / continueItemsPerPage));
  const safeContinuePage   = Math.min(continuePage, continueTotalPages);
  const visibleContinueItems = useMemo(() => {
    const start = (safeContinuePage - 1) * continueItemsPerPage;
    return sortedContinueItems.slice(start, start + continueItemsPerPage);
  }, [sortedContinueItems, safeContinuePage, continueItemsPerPage]);

  // Reseta para a primeira página ao trocar ordenação ou tamanho de tela
  useEffect(() => {
    Promise.resolve().then(() => setContinuePage(1));
  }, [continueSortMode, continueItemsPerPage]);

  return (
    <PageShell variant="wide">
      <div className="flex flex-col gap-10">
        {/* Hero */}
        {isHeroLoading ? (
          <div className="h-[480px] animate-pulse rounded-[28px] bg-white/[0.03]" />
        ) : (
          <HeroSpotlight
            items={heroItems}
            onSnooze={snoozeItem}
            onLogSignal={logSignal}
            onNavigate={handleNavigate}
          />
        )}

        {/* Novos episódios esperando */}
        {(isNewEpisodesLoading || newEpisodeItems.length > 0 || newEpisodesError !== null) && (
          <section>
            <SectionHeader
              eyebrow="Disponível agora"
              accent="rose"
              title="Novos episódios esperando"
              size="sm"
              action={
                !isNewEpisodesLoading && newEpisodeItems.length > 0 ? (
                  <span className="rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1 text-[11px] font-bold text-white/50">
                    {newEpisodeItems.length}{" "}
                    {newEpisodeItems.length === 1 ? "título" : "títulos"}
                  </span>
                ) : undefined
              }
              className="mb-4"
            />

            {isNewEpisodesLoading ? (
              <div className="grid gap-2.5 md:grid-cols-2">
                {[...Array(4)].map((_, i) => (
                  <div
                    key={i}
                    className="h-[76px] animate-pulse rounded-2xl bg-white/[0.04]"
                  />
                ))}
              </div>
            ) : newEpisodesError !== null ? (
              <p className="py-3 text-xs text-white/30">
                Não foi possível carregar os episódios agora.
              </p>
            ) : (
              <div className="grid gap-2.5 md:grid-cols-2">
                {newEpisodeItems.map((item) => (
                  <NewEpisodeCard
                    key={item.content_id}
                    item={item}
                    onClick={() => handleNewEpisodeNavigate(item)}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Continue de onde parou */}
        {(isContinueLoading || continueItems.length > 0 || continueError !== null) && (
          <section>
            <SectionHeader
              eyebrow="Em andamento"
              accent="indigo"
              title="Continue de onde parou"
              size="sm"
              action={
                <div className="flex items-center gap-3">
                  {!isContinueLoading && continueItems.length > 0 && (
                    <span className="rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1 text-[11px] font-bold text-white/50">
                      {continueItems.length}{" "}
                      {continueItems.length === 1 ? "título" : "títulos"}
                    </span>
                  )}
                  <div className="flex rounded-full border border-white/[0.10] bg-white/[0.04] p-0.5">
                    <button
                      type="button"
                      onClick={() => setContinueSortMode("recent")}
                      className={[
                        "rounded-full px-3 py-1 text-[11px] font-bold transition-all",
                        continueSortMode === "recent"
                          ? "bg-white text-zinc-900"
                          : "text-white/45 hover:text-white/70",
                      ].join(" ")}
                    >
                      Recentes
                    </button>
                    <button
                      type="button"
                      onClick={() => setContinueSortMode("season")}
                      className={[
                        "rounded-full px-3 py-1 text-[11px] font-bold transition-all",
                        continueSortMode === "season"
                          ? "bg-white text-zinc-900"
                          : "text-white/45 hover:text-white/70",
                      ].join(" ")}
                    >
                      Mais fáceis
                    </button>
                    <button
                      type="button"
                      onClick={() => setContinueSortMode("series")}
                      className={[
                        "rounded-full px-3 py-1 text-[11px] font-bold transition-all",
                        continueSortMode === "series"
                          ? "bg-white text-zinc-900"
                          : "text-white/45 hover:text-white/70",
                      ].join(" ")}
                    >
                      Ficar em dia
                    </button>
                  </div>
                </div>
              }
              className="mb-4"
            />

            {isContinueLoading ? (
              <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {[...Array(continueItemsPerPage)].map((_, i) => (
                  <div
                    key={i}
                    className="h-[95px] animate-pulse rounded-2xl bg-white/[0.04]"
                  />
                ))}
              </div>
            ) : continueError !== null ? (
              <p className="py-3 text-xs text-white/30">
                Não foi possível carregar os títulos em andamento agora.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                  {visibleContinueItems.map((item) => (
                    <ContinueCard
                      key={item.content_id}
                      item={item}
                      onClick={() => handleContinueNavigate(item)}
                    />
                  ))}
                </div>
                <SectionPagination
                  page={safeContinuePage}
                  totalPages={continueTotalPages}
                  onPageChange={setContinuePage}
                />
              </div>
            )}
          </section>
        )}

        {/* Da sua watchlist */}
        {(isWatchlistPicksLoading || watchlistPicks.length > 0) && (
          <section>
            <SectionHeader
              eyebrow="Da sua watchlist"
              accent="cyan"
              title="O que ver primeiro?"
              size="sm"
              action={
                <button
                  type="button"
                  onClick={refreshWatchlistPicks}
                  disabled={isWatchlistPicksLoading}
                  className="h-8 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 text-[11px] font-bold text-white/45 transition-all hover:border-white/[0.16] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Trocar sugestões
                </button>
              }
              className="mb-5 sm:items-center"
            />

            {isWatchlistPicksLoading ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-9">
                {[...Array(9)].map((_, i) => (
                  <div
                    key={i}
                    className={[
                      "aspect-[2/3] animate-pulse rounded-xl bg-white/[0.04]",
                      i >= 8 ? "hidden sm:block" : "",
                    ].join(" ")}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-9">
                {watchlistPicks.map((item, index) => (
                  <div
                    key={item.content_id}
                    className={index >= 8 ? "hidden sm:block" : ""}
                  >
                    <WatchlistPickCard
                      item={item}
                      onClick={() => handleWatchlistPickNavigate(item)}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Últimos vistos */}
        {(isRecentlyWatchedLoading || recentlyWatched.length > 0) && (
          <section>
            <SectionHeader
              eyebrow="Histórico"
              accent="neutral"
              title="Últimos vistos"
              size="sm"
              className="mb-4"
            />

            {isRecentlyWatchedLoading ? (
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className={[
                      "h-[72px] animate-pulse rounded-xl bg-white/[0.04] sm:h-[68px]",
                      i >= 3 ? "hidden sm:block" : "",
                    ].join(" ")}
                  />
                ))}
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {recentlyWatched.map((item, index) => (
                  <div
                    key={item.content_id}
                    className={index >= 3 ? "hidden sm:block" : ""}
                  >
                    <RecentlyWatchedCard
                      item={item}
                      onClick={() => handleRecentlyWatchedNavigate(item)}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Boa hora pra começar */}
        {(isStartSeriesLoading || startSeriesPicks.length > 0) && (
          <section>
            <SectionHeader
              eyebrow="Da sua watchlist"
              accent="amber"
              title="Boa hora pra começar"
              subtitle="Séries premiadas, bem avaliadas e fáceis de entrar — priorizadas por disponibilidade e relevância editorial."
              size="sm"
              action={
                <button
                  type="button"
                  onClick={refreshStartSeriesPicks}
                  disabled={isStartSeriesLoading}
                  className="h-8 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 text-[11px] font-bold text-white/45 transition-all hover:border-white/[0.16] hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Trocar
                </button>
              }
              className="mb-4 sm:items-start"
            />

            <StartSeriesBanner
              items={startSeriesPicks}
              loading={isStartSeriesLoading}
              onPick={handleStartSeriesNavigate}
            />
          </section>
        )}
      </div>
    </PageShell>
  );
}

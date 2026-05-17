"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

import type { ScoredItem, SignalType } from "@/components/HeroSpotlight/types";

type ContinueSortMode = "recent" | "easy";

function getMediaType(item: ScoredItem) {
  return item.content_type === "filme" ? "movie" : "tv";
}

function getTmdbId(item: ScoredItem) {
  const source = item as ScoredItem & {
    tmdbId?: number | string | null;
    content_id?: number | string | null;
    id?: number | string | null;
  };

  return String(source.tmdbId ?? source.content_id ?? source.id ?? "").replace(
    /\D/g,
    "",
  );
}

async function postCuradoriaAction(body: unknown) {
  await fetch("/api/poplog3/acompanhando", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

export default function AcompanhandoPage() {
  const router = useRouter();

  const [heroItems, setHeroItems] = useState<ScoredItem[]>([]);
  const [isHeroLoading, setIsHeroLoading] = useState(true);

  const [newEpisodeItems, setNewEpisodeItems] = useState<NewEpisodeItem[]>([]);
  const [isNewEpisodesLoading, setIsNewEpisodesLoading] = useState(true);

  const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);
  const [isContinueLoading, setIsContinueLoading] = useState(true);
  const [continueSortMode, setContinueSortMode] = useState<ContinueSortMode>("recent");

  useEffect(() => {
    fetch("/api/poplog3/continuity/hero")
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.candidates)) {
          setHeroItems(data.candidates);
        }
      })
      .catch((err) => {
        console.error("[AcompanhandoPage] Falha ao carregar Hero:", err);
      })
      .finally(() => {
        setIsHeroLoading(false);
      });
  }, []);

  useEffect(() => {
    fetch("/api/poplog3/continuity/new-episodes")
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.items)) {
          setNewEpisodeItems(data.items);
        }
      })
      .catch((err) => {
        console.error("[AcompanhandoPage] Falha ao carregar novos episódios:", err);
      })
      .finally(() => {
        setIsNewEpisodesLoading(false);
      });
  }, []);

  useEffect(() => {
    fetch("/api/poplog3/continuity/continue")
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.items)) {
          setContinueItems(data.items);
        }
      })
      .catch((err) => {
        console.error("[AcompanhandoPage] Falha ao carregar continuidade:", err);
      })
      .finally(() => {
        setIsContinueLoading(false);
      });
  }, []);

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

  const sortedContinueItems = useMemo(() => {
    if (continueSortMode === "easy") {
      return [...continueItems].sort(
        (a, b) => a.remaining_minutes - b.remaining_minutes,
      );
    }
    // "recent": já vem ordenado por last_watched_at DESC do servidor
    return continueItems;
  }, [continueItems, continueSortMode]);

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
        {(isNewEpisodesLoading || newEpisodeItems.length > 0) && (
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
        {(isContinueLoading || continueItems.length > 0) && (
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
                      onClick={() => setContinueSortMode("easy")}
                      className={[
                        "rounded-full px-3 py-1 text-[11px] font-bold transition-all",
                        continueSortMode === "easy"
                          ? "bg-white text-zinc-900"
                          : "text-white/45 hover:text-white/70",
                      ].join(" ")}
                    >
                      Mais fáceis
                    </button>
                  </div>
                </div>
              }
              className="mb-4"
            />

            {isContinueLoading ? (
              <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="h-[95px] animate-pulse rounded-2xl bg-white/[0.04]"
                  />
                ))}
              </div>
            ) : (
              <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {sortedContinueItems.map((item) => (
                  <ContinueCard
                    key={item.content_id}
                    item={item}
                    onClick={() => handleContinueNavigate(item)}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </PageShell>
  );
}

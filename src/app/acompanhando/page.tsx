"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import PageShell from "@/components/layout/PageShell";
import HeroSpotlight from "@/components/HeroSpotlight";

import { useCuradoriaEngine } from "@/hooks/useCuradoriaEngine";

import type { ScoredItem } from "@/components/HeroSpotlight/types";

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

export default function AcompanhandoPage() {
  const router = useRouter();

  const { snoozeItem, logSignal } = useCuradoriaEngine();

  const [heroItems, setHeroItems] = useState<ScoredItem[]>([]);
  const [isHeroLoading, setIsHeroLoading] = useState(true);

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

  function handleNavigate(item: ScoredItem) {
    router.push(`/title/${getMediaType(item)}/${getTmdbId(item)}`);
  }

  return (
    <PageShell variant="wide">
      <div className="flex flex-col">
        {isHeroLoading ? (
          <div className="h-[480px] rounded-[28px] bg-white/[0.03] animate-pulse" />
        ) : (
          <HeroSpotlight
            items={heroItems}
            onSnooze={snoozeItem}
            onLogSignal={logSignal}
            onNavigate={handleNavigate}
          />
        )}
      </div>
    </PageShell>
  );
}
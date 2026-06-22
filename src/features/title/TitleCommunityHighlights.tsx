"use client";

import SourceChip from "@/components/attribution/SourceChip";
import ContextualAttribution from "@/components/attribution/ContextualAttribution";
import { ChevronDown, Quote } from "lucide-react";
import { useEffect, useState } from "react";

type CommunityHighlightSource = "tmdb" | "trakt";

type CommunityHighlight = {
  id: string;
  source: CommunityHighlightSource;
  author: string;
  content: string;
};

type TitleCommunityHighlightsProps = {
  movieTmdbId: number;
  movieTitle: string;
  onOpenAll: () => void;
};

export default function TitleCommunityHighlights({
  movieTmdbId,
  movieTitle,
  onOpenAll,
}: TitleCommunityHighlightsProps) {
  const [expanded, setExpanded] = useState(false);
  const [highlights, setHighlights] = useState<CommunityHighlight[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!expanded) {
      return () => {
        cancelled = true;
      };
    }

    async function loadHighlights() {
      try {
        setLoading(true);

        const params = new URLSearchParams({
          tmdbId: String(movieTmdbId),
          title: movieTitle,
        });

        const response = await fetch(`/api/social/highlights?${params}`);

        if (!response.ok) {
          throw new Error("Failed to load community highlights");
        }

        const data = await response.json();

        if (!cancelled) {
          setHighlights(Array.isArray(data.highlights) ? data.highlights : []);
        }
      } catch {
        if (!cancelled) {
          setHighlights([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadHighlights();

    return () => {
      cancelled = true;
    };
  }, [expanded, movieTmdbId, movieTitle]);

  const visibleHighlights = highlights.slice(0, 2);

  return (
    <section
      aria-label="Comentários da comunidade"
      className="w-full rounded-[1.5rem] border border-white/[0.08] bg-white/[0.035] p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fuchsia-400/10 text-fuchsia-200/75">
            <Quote size={17} />
          </div>

          <h2 className="truncate text-[18px] font-black tracking-[-0.04em] text-white sm:text-[21px]">
            Opiniões Populares
          </h2>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {expanded && (
            <button
              type="button"
              onClick={onOpenAll}
              className="hidden rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/60 transition hover:border-white/[0.18] hover:bg-white/[0.09] hover:text-white sm:inline-flex"
            >
              Ver todos
            </button>
          )}

          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="inline-flex items-center gap-2 rounded-full border border-fuchsia-200/18 bg-fuchsia-400/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-fuchsia-100/78 transition hover:border-fuchsia-100/30 hover:bg-fuchsia-300/14 hover:text-white"
          >
            {expanded ? "Ocultar" : "Ver comentários"}
            <ChevronDown
              size={14}
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>

      {expanded && (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {loading
              ? [0, 1].map((item) => (
                  <article
                    key={item}
                    className="min-h-[128px] animate-pulse rounded-2xl border border-white/[0.07] bg-black/20 p-4"
                  >
                    <div className="h-5 w-20 rounded-full bg-white/[0.08]" />
                    <div className="mt-4 h-3 w-full rounded bg-white/[0.07]" />
                    <div className="mt-2 h-3 w-5/6 rounded bg-white/[0.07]" />
                    <div className="mt-2 h-3 w-4/6 rounded bg-white/[0.07]" />
                  </article>
                ))
              : visibleHighlights.map((highlight) => (
                  <article
                    key={highlight.id}
                    className="rounded-2xl border border-white/[0.07] bg-black/20 p-3.5 sm:p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <SourceChip sourceId={highlight.source} />

                      <span className="truncate text-[10px] text-white/35">
                        @{highlight.author}
                      </span>
                    </div>

                    <p className="mt-3 text-[11px] leading-relaxed text-white/72 sm:text-[12px]">
                      {highlight.content}
                    </p>
                  </article>
                ))}
          </div>

          {!loading && visibleHighlights.length === 0 && (
            <p className="mt-4 rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-sm text-white/55">
              Nenhum comentário em destaque por enquanto.
            </p>
          )}

          {!loading && visibleHighlights.length > 0 && (
            <ContextualAttribution
              context="community"
              sourcesUsed={visibleHighlights.map((highlight) => highlight.source)}
              className="mt-4"
            />
          )}
        </>
      )}
    </section>
  );
}

"use client";
// src/features/title/MoreLikeThis.tsx

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  GENRE_NAMES,
  getContentTypeLabel,
  formatKeyword,
  formatPercent,
} from "@/lib/title-utils";
import type { RawCandidate } from "@/features/title/title-types";

// ─── Types ────────────────────────────────────────────────────────────────────

type ScoredItem = RawCandidate & {
  _score: number;
  _compatibility: number;
  _reason: string;
};

type Props = {
  candidates: RawCandidate[];
  sourceGenreIds: number[];
  sourceKeywords: string[];
  sourceYear: number | null;
  mediaType: "movie" | "tv";
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getItemTitle(item: RawCandidate): string {
  return item.title ?? item.name ?? "Sem título";
}

function getItemYear(item: RawCandidate): string | null {
  return (item.release_date ?? item.first_air_date)?.slice(0, 4) ?? null;
}

function getReason(
  fromRecommendations: boolean,
  fromSimilar: boolean,
  matchedKeywords: string[],
  matchedGenreIds: number[],
): string {
  if (fromRecommendations && fromSimilar) return "Muito similar a este título";
  if (fromRecommendations) return "Quem assistiu isso também curtiu";
  if (matchedKeywords.length >= 2) return "História muito parecida";
  if (matchedKeywords.length === 1) return `Tema em comum: ${formatKeyword(matchedKeywords[0])}`;
  if (matchedGenreIds.length >= 2) return "Mesmos gêneros";
  if (matchedGenreIds.length === 1) {
    const genreName = GENRE_NAMES[matchedGenreIds[0]];
    return genreName ? `Gênero em comum: ${genreName}` : "Estilo parecido";
  }
  if (fromSimilar) return "Estilo parecido";
  return "Você pode gostar";
}

async function fetchKeywords(type: string, id: number): Promise<string[]> {
  const res = await fetch(`/api/keywords?type=${type}&id=${id}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.keywords ?? []) as string[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MoreLikeThis({
  candidates,
  sourceGenreIds,
  sourceKeywords,
  sourceYear,
  mediaType,
}: Props) {
  const [items, setItems] = useState<ScoredItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function build() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      let excludeIds = new Set<string>();
      if (user) {
        const { data: userTitles } = await supabase
          .from("user_titles")
          .select("tmdb_id, media_type, status")
          .eq("user_id", user.id)
          .eq("status", "watched");

        excludeIds = new Set(
          (userTitles ?? []).map((t) => `${t.media_type}-${t.tmdb_id}`),
        );
      }

      const available = candidates.filter(
        (c) => !excludeIds.has(`${mediaType}-${c.id}`),
      );

      if (available.length === 0) {
        setItems([]);
        setReady(true);
        return;
      }

      const sourceGenreSet   = new Set(sourceGenreIds);
      const sourceKeywordSet = new Set(sourceKeywords);

      const preScored = available
        .map((c) => {
          const genreMatches = (c.genre_ids ?? []).filter((id) => sourceGenreSet.has(id)).length;
          const rating = typeof c.vote_average === "number" ? c.vote_average : 0;
          const preScore =
            (c._fromRecommendations && c._fromSimilar ? 50 : 0) +
            (c._fromRecommendations && !c._fromSimilar ? 30 : 0) +
            (!c._fromRecommendations && c._fromSimilar ? 18 : 0) +
            genreMatches * 10 +
            Math.min(rating * 2, 16);
          return { ...c, _preScore: preScore };
        })
        .sort((a, b) => b._preScore - a._preScore)
        .slice(0, 15);

      const withKeywords = await Promise.all(
        preScored.map(async (c) => ({
          ...c,
          _keywords: await fetchKeywords(mediaType, c.id),
        })),
      );

      const scored: ScoredItem[] = withKeywords
        .map((c) => {
          const itemGenreIds  = c.genre_ids ?? [];
          const itemKeywords  = c._keywords ?? [];

          const matchedGenreIds  = itemGenreIds.filter((id) => sourceGenreSet.has(id));
          const matchedKeywords  = itemKeywords.filter((kw) => sourceKeywordSet.has(kw));
          const genreMatches     = matchedGenreIds.length;
          const keywordMatches   = matchedKeywords.length;

          const rating    = typeof c.vote_average === "number" ? c.vote_average : 0;
          const voteCount = typeof c.vote_count === "number" ? c.vote_count : 0;
          const itemYear  = Number(((c.release_date ?? c.first_air_date) as string | undefined)?.slice(0, 4)) || null;
          const yearDistance = sourceYear && itemYear ? Math.abs(sourceYear - itemYear) : null;

          const rawScore =
            (c._fromRecommendations && c._fromSimilar ? 50 : 0) +
            (c._fromRecommendations && !c._fromSimilar ? 30 : 0) +
            (!c._fromRecommendations && c._fromSimilar ? 18 : 0) +
            genreMatches * 10 +
            keywordMatches * 14 +
            Math.min(rating * 2, 16) +
            Math.min(Math.log10(voteCount + 1) * 4, 12) +
            (yearDistance === null ? 0 : Math.max(0, 8 - yearDistance));

          let compatibility = 50;
          if (c._fromRecommendations && c._fromSimilar) compatibility += 15;
          else if (c._fromRecommendations) compatibility += 10;
          else if (c._fromSimilar) compatibility += 5;
          compatibility += Math.min(keywordMatches * 5, 12);
          compatibility += Math.min(genreMatches * 4, 10);
          if (rating >= 8) compatibility += 4;
          else if (rating >= 7) compatibility += 2;
          if (compatibility > 82) compatibility = 82 + (compatibility - 82) * 0.4;
          compatibility = Math.max(60, Math.min(93, Math.round(compatibility)));

          const reason = getReason(c._fromRecommendations, c._fromSimilar, matchedKeywords, matchedGenreIds);

          return { ...c, _score: rawScore, _compatibility: compatibility, _reason: reason };
        })
        .sort((a, b) => b._score - a._score);

      const top8  = scored.slice(0, 8).sort(() => Math.random() - 0.5);
      const final = top8.slice(0, 5);

      setItems(final);
      setReady(true);
    }

    build();
  }, [candidates, sourceGenreIds, sourceKeywords, sourceYear, mediaType]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <section>
        <div className="mb-4 h-3 w-32 animate-pulse rounded-full bg-sky-400/20" />
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 no-scrollbar sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0 lg:pb-0">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="w-[140px] shrink-0 lg:w-auto">
              <div className="aspect-[2/3] animate-pulse rounded-2xl bg-white/5" />
              <div className="mt-2 h-2 w-3/4 animate-pulse rounded-full bg-white/5" />
              <div className="mt-1 h-2 w-1/2 animate-pulse rounded-full bg-white/5" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!items.length) return null;

  return (
    <section>
      <h2 className="mb-4 text-[11px] font-black uppercase tracking-[0.35em] text-sky-300">
        Mais como este
      </h2>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 no-scrollbar sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0 lg:pb-0">
        {items.map((item) => {
          const itemTitle     = getItemTitle(item);
          const itemYear      = getItemYear(item);
          const itemRating    = typeof item.vote_average === "number" ? item.vote_average.toFixed(1) : null;
          const itemTypeLabel = getContentTypeLabel(mediaType, item.genre_ids ?? []);

          return (
            <Link
              key={item.id}
              href={`/title/${mediaType}/${item.id}`}
              className="group w-[140px] shrink-0 overflow-hidden rounded-[1.1rem] border border-white/10 bg-white/[0.04] shadow-[0_16px_48px_rgba(0,0,0,0.4)] transition duration-300 hover:-translate-y-1 hover:border-sky-400/35 hover:bg-white/[0.07] hover:shadow-[0_22px_60px_rgba(56,189,248,0.1)] lg:w-auto lg:shrink"
            >
              <div className="relative aspect-[2/3] overflow-hidden bg-zinc-900">
                {item.poster_path ? (
                  <Image
                    src={`https://image.tmdb.org/t/p/w342${item.poster_path}`}
                    alt={itemTitle}
                    width={342}
                    height={513}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                ) : item.backdrop_path ? (
                  <Image
                    src={`https://image.tmdb.org/t/p/w780${item.backdrop_path}`}
                    alt={itemTitle}
                    width={780}
                    height={439}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                    Sem imagem
                  </div>
                )}
                {item._compatibility && (
                  <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-black text-sky-300 backdrop-blur-sm">
                    {formatPercent(item._compatibility)}
                  </div>
                )}
              </div>
              <div className="space-y-1 p-3 lg:p-4">
                <h3 className="line-clamp-2 text-xs font-black leading-tight text-white lg:text-sm">
                  {itemTitle}
                </h3>
                <div className="flex flex-wrap gap-x-1.5 gap-y-1 text-[10px] font-semibold text-zinc-400 lg:text-xs">
                  <span>{itemTypeLabel}</span>
                  {itemYear && <span>• {itemYear}</span>}
                  {itemRating && <span>• ★ {itemRating}</span>}
                </div>
                {item._reason && (
                  <p className="line-clamp-1 text-[9px] text-zinc-500 lg:text-[10px]">
                    {item._reason}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

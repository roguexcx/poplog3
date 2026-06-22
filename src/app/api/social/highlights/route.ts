import { NextRequest, NextResponse } from "next/server";

import { traktGet } from "@/server/api-clients/trakt/client";
import { translateToPtBr } from "@/server/translate/translate-to-pt-br";

type TraktUser = {
  username?: string;
  vip?: boolean;
  vip_ep?: boolean;
};

type TraktComment = {
  id: number;
  comment: string;
  spoiler?: boolean;
  review?: boolean;
  replies?: number;
  likes?: number;
  user?: TraktUser;
};

type CommunityHighlight = {
  id: string;
  source: "trakt";
  author: string;
  content: string;
  originalContent?: string;
  translationStatus?: "translated" | "original";
  sourceLanguage?: string | null;
  score: number;
};

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueById(items: CommunityHighlight[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function scoreTraktComment(comment: TraktComment) {
  const content = cleanText(comment.comment ?? "");

  let score = 0;

  if (content.length >= 60) score += 2;
  if (content.length >= 160) score += 2;
  if (content.length > 1200) score -= 2;
  if (comment.review) score += 2;
  if ((comment.likes ?? 0) > 0) score += Math.min(comment.likes ?? 0, 8);
  if ((comment.replies ?? 0) > 0) score += Math.min(comment.replies ?? 0, 4);
  if (comment.user?.vip) score += 1;
  if (comment.user?.vip_ep) score += 1;
  if (comment.spoiler) score -= 8;

  return score;
}

async function toTraktHighlight(
  comment: TraktComment,
): Promise<CommunityHighlight> {
  const originalContent = cleanText(comment.comment);
  const translation = await translateToPtBr(originalContent);

  return {
    id: `trakt-${comment.id}`,
    source: "trakt",
    author: comment.user?.username || "trakt",
    content: translation.translatedText || originalContent,
    originalContent,
    translationStatus: translation.translated ? "translated" : "original",
    sourceLanguage: translation.sourceLanguage,
    score: scoreTraktComment(comment),
  };
}

async function findTraktMovieIdFromTmdb(tmdbId: number) {
  const results = await traktGet<Array<{ movie?: { ids?: { slug?: string; trakt?: number } } }>>(
    `/search/tmdb/${tmdbId}`,
    {
      params: { type: "movie" },
      ttlSeconds: 3600,
      cache: "no-store",
    },
  );

  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const first = results.find(
    (item) => item?.movie?.ids?.slug || item?.movie?.ids?.trakt,
  );

  return first?.movie?.ids?.slug || first?.movie?.ids?.trakt || null;
}

async function getTraktHighlights(tmdbId: number) {
  try {
    const traktMovieId = await findTraktMovieIdFromTmdb(tmdbId);

    if (!traktMovieId) {
      return [];
    }

    const rawComments = await traktGet<TraktComment[]>(
      `/movies/${encodeURIComponent(String(traktMovieId))}/comments/newest`,
      { ttlSeconds: 900, cache: "no-store" },
    );

    const bestTraktComments = Array.isArray(rawComments)
      ? rawComments
          .filter((comment) => {
            const text = cleanText(comment?.comment ?? "");
            return text.length >= 30 && !comment?.spoiler;
          })
          .sort((a, b) => scoreTraktComment(b) - scoreTraktComment(a))
          .slice(0, 4)
      : [];

    return await Promise.all(bestTraktComments.map(toTraktHighlight));
  } catch (error) {
    console.warn(
      "[social/highlights] Trakt comments falhou:",
      error instanceof Error ? error.message : error,
    );

    return [];
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const tmdbId = Number(searchParams.get("tmdbId"));

  if (!Number.isFinite(tmdbId)) {
    return NextResponse.json(
      { ok: false, error: "tmdbId inválido.", highlights: [] },
      { status: 400 },
    );
  }

  const highlights = (await getTraktHighlights(tmdbId))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return NextResponse.json({
    ok: true,
    usedTmdbApi: false,
    skippedReasons: ["tmdb_reviews_disabled"],
    sources: {
      tmdb: 0,
      trakt: highlights.length,
    },
    highlights: uniqueById(highlights).map(({ score: _score, ...h }) => h),
  });
}

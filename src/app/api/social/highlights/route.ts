import { NextRequest, NextResponse } from "next/server";

import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { translateToPtBr } from "@/server/translate/translate-to-pt-br";

const TRAKT_API_BASE = "https://api.trakt.tv";

type HighlightSource = "tmdb" | "trakt";

type TmdbReview = {
  id: string;
  author: string;
  content: string;
  created_at?: string;
  updated_at?: string;
  author_details?: {
    rating?: number | null;
  };
};

type TmdbReviewsResponse = {
  results?: TmdbReview[];
};

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
  source: HighlightSource;
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

function scoreTmdbReview(review: TmdbReview) {
  const content = cleanText(review.content ?? "");
  const rating = review.author_details?.rating ?? 0;

  let score = 0;

  if (content.length >= 80) score += 2;
  if (content.length >= 200) score += 2;
  if (content.length > 1200) score -= 2;
  if (rating >= 7) score += 2;
  if (rating >= 9) score += 1;
  if (review.updated_at || review.created_at) score += 1;

  return score;
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

async function toTmdbHighlight(review: TmdbReview): Promise<CommunityHighlight> {
  const originalContent = cleanText(review.content);
  const translation = await translateToPtBr(originalContent);

  return {
    id: `tmdb-${review.id}`,
    source: "tmdb",
    author: review.author || "TMDB user",
    content: translation.translatedText || originalContent,
    originalContent,
    translationStatus: translation.translated ? "translated" : "original",
    sourceLanguage: translation.sourceLanguage,
    score: scoreTmdbReview(review),
  };
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

function getTraktClientId() {
  return process.env.TRAKT_CLIENT_ID || "";
}

async function traktFetch(path: string) {
  const clientId = getTraktClientId();

  if (!clientId) {
    throw new Error("TRAKT_CLIENT_ID não configurado no .env.local");
  }

  const response = await fetch(`${TRAKT_API_BASE}${path}`, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "POPLOG/3.0 (contact: local-dev)",
      "trakt-api-version": "2",
      "trakt-api-key": clientId,
    },
  });

  const text = await response.text();

  let body: unknown = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(
      `Erro Trakt HTTP ${response.status} em ${path}: ${
        typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body)
      }`,
    );
  }

  return body;
}

async function findTraktMovieIdFromTmdb(tmdbId: number) {
  const results = await traktFetch(`/search/tmdb/${tmdbId}?type=movie`);

  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const first = results.find(
    (item) => item?.movie?.ids?.slug || item?.movie?.ids?.trakt,
  );

  return first?.movie?.ids?.slug || first?.movie?.ids?.trakt || null;
}

async function getTmdbHighlights(tmdbId: number) {
  try {
    const data = await tmdbFetch<TmdbReviewsResponse>(
      `/movie/${tmdbId}/reviews`,
      {
        params: {
          language: "en-US",
          page: 1,
        },
        revalidate: 21600,
      },
    );

    const bestTmdbReviews =
      data.results
        ?.filter((review) => cleanText(review.content ?? "").length >= 40)
        .sort((a, b) => scoreTmdbReview(b) - scoreTmdbReview(a))
        .slice(0, 4) ?? [];

    return await Promise.all(bestTmdbReviews.map(toTmdbHighlight));
  } catch (error) {
    console.warn(
      "[social/highlights] TMDB reviews falhou:",
      error instanceof Error ? error.message : error,
    );

    return [];
  }
}

async function getTraktHighlights(tmdbId: number) {
  try {
    const traktMovieId = await findTraktMovieIdFromTmdb(tmdbId);

    if (!traktMovieId) {
      return [];
    }

    const rawComments = await traktFetch(
      `/movies/${encodeURIComponent(String(traktMovieId))}/comments/newest`,
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

function pickHighlights(
  tmdbHighlights: CommunityHighlight[],
  traktHighlights: CommunityHighlight[],
) {
  const bestTmdb = tmdbHighlights[0] ?? null;
  const bestTrakt = traktHighlights[0] ?? null;

  const selected = [bestTmdb, bestTrakt].filter(Boolean) as CommunityHighlight[];

  const extraPool = [...tmdbHighlights.slice(1), ...traktHighlights.slice(1)]
    .sort((a, b) => b.score - a.score);

  const extra = extraPool.find(
    (item) => !selected.some((selectedItem) => selectedItem.id === item.id),
  );

  if (extra) selected.push(extra);

  return uniqueById(selected).slice(0, 3);
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

  const [tmdbHighlights, traktHighlights] = await Promise.all([
    getTmdbHighlights(tmdbId),
    getTraktHighlights(tmdbId),
  ]);

  const highlights = pickHighlights(tmdbHighlights, traktHighlights).map(
    ({ score: _score, ...highlight }) => highlight,
  );

  return NextResponse.json({
    ok: true,
    sources: {
      tmdb: tmdbHighlights.length,
      trakt: traktHighlights.length,
    },
    highlights,
  });
}

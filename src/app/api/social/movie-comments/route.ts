import { NextRequest, NextResponse } from "next/server";

import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { translateToPtBr } from "@/server/translate/translate-to-pt-br";

const TRAKT_API_BASE = "https://api.trakt.tv";

type SourceType = "tmdb" | "trakt";

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

type SocialComment = {
  id: string;
  source: SourceType;

  author: string;

  content: string;

  originalContent?: string;

  translationStatus?: "translated" | "original";

  sourceLanguage?: string | null;

  spoiler?: boolean;

  likes?: number;

  score: number;
};

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueById<T extends { id: string }>(items: T[]) {
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

  if ((comment.likes ?? 0) > 0) {
    score += Math.min(comment.likes ?? 0, 8);
  }

  if ((comment.replies ?? 0) > 0) {
    score += Math.min(comment.replies ?? 0, 4);
  }

  if (comment.user?.vip) score += 1;
  if (comment.user?.vip_ep) score += 1;

  if (comment.spoiler) score -= 8;

  return score;
}

async function translateText(text: string) {
  const translation = await translateToPtBr(text);

  return {
    content: translation.translatedText || text,
    translationStatus: translation.translated
      ? "translated"
      : "original",
    sourceLanguage: translation.sourceLanguage,
  } as const;
}

async function toTmdbComment(
  review: TmdbReview,
): Promise<SocialComment> {
  const originalContent = cleanText(review.content ?? "");

  const translated = await translateText(originalContent);

  return {
    id: `tmdb-${review.id}`,

    source: "tmdb",

    author: review.author || "TMDB user",

    content: translated.content,

    originalContent,

    translationStatus: translated.translationStatus,

    sourceLanguage: translated.sourceLanguage,

    spoiler: false,

    likes: review.author_details?.rating ?? 0,

    score: scoreTmdbReview(review),
  };
}

async function toTraktComment(
  comment: TraktComment,
): Promise<SocialComment> {
  const originalContent = cleanText(comment.comment ?? "");

  const translated = await translateText(originalContent);

  return {
    id: `trakt-${comment.id}`,

    source: "trakt",

    author: comment.user?.username || "trakt",

    content: translated.content,

    originalContent,

    translationStatus: translated.translationStatus,

    sourceLanguage: translated.sourceLanguage,

    spoiler: Boolean(comment.spoiler),

    likes: comment.likes ?? 0,

    score: scoreTraktComment(comment),
  };
}

function getTraktClientId() {
  return process.env.TRAKT_CLIENT_ID || "";
}

async function traktFetch(path: string) {
  const clientId = getTraktClientId();

  if (!clientId) {
    throw new Error("TRAKT_CLIENT_ID não configurado");
  }

  const response = await fetch(`${TRAKT_API_BASE}${path}`, {
    cache: "no-store",

    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",

      "User-Agent": "POPLOG/3.0",

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
      `Erro Trakt HTTP ${response.status}: ${
        typeof body === "string"
          ? body.slice(0, 300)
          : JSON.stringify(body)
      }`,
    );
  }

  return body;
}

async function findTraktMovieIdFromTmdb(tmdbId: number) {
  const results = await traktFetch(
    `/search/tmdb/${tmdbId}?type=movie`,
  );

  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const first = results.find(
    (item) => item?.movie?.ids?.slug || item?.movie?.ids?.trakt,
  );

  return (
    first?.movie?.ids?.slug ||
    first?.movie?.ids?.trakt ||
    null
  );
}

async function getTmdbComments(tmdbId: number) {
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

    const reviews =
      data.results
        ?.filter(
          (review) =>
            cleanText(review.content ?? "").length >= 40,
        )
        .sort(
          (a, b) =>
            scoreTmdbReview(b) - scoreTmdbReview(a),
        )
        .slice(0, 20) ?? [];

    return await Promise.all(reviews.map(toTmdbComment));
  } catch (error) {
    console.warn(
      "[movie-comments] TMDB falhou:",
      error instanceof Error ? error.message : error,
    );

    return [];
  }
}

async function getTraktComments(tmdbId: number) {
  try {
    const traktMovieId =
      await findTraktMovieIdFromTmdb(tmdbId);

    if (!traktMovieId) {
      return [];
    }

    const rawComments = await traktFetch(
      `/movies/${encodeURIComponent(
        String(traktMovieId),
      )}/comments/newest`,
    );

    const comments = Array.isArray(rawComments)
      ? rawComments
          .filter((comment) => {
            const text = cleanText(
              comment?.comment ?? "",
            );

            return text.length >= 30;
          })
          .sort(
            (a, b) =>
              scoreTraktComment(b) -
              scoreTraktComment(a),
          )
          .slice(0, 20)
      : [];

    return await Promise.all(
      comments.map(toTraktComment),
    );
  } catch (error) {
    console.warn(
      "[movie-comments] Trakt falhou:",
      error instanceof Error ? error.message : error,
    );

    return [];
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const tmdbId = Number(
    searchParams.get("tmdbId"),
  );

  if (!Number.isFinite(tmdbId)) {
    return NextResponse.json(
      {
        ok: false,
        error: "tmdbId inválido",
      },
      {
        status: 400,
      },
    );
  }

  const [tmdbComments, traktComments] =
    await Promise.all([
      getTmdbComments(tmdbId),
      getTraktComments(tmdbId),
    ]);

  const allComments = uniqueById(
    [...tmdbComments, ...traktComments].sort(
      (a, b) => b.score - a.score,
    ),
  );

  return NextResponse.json({
    ok: true,

    counts: {
      tmdb: tmdbComments.length,

      trakt: traktComments.length,

      all: allComments.length,
    },

    comments: {
      all: allComments.map(
        ({ score: _score, ...comment }) =>
          comment,
      ),

      tmdb: tmdbComments.map(
        ({ score: _score, ...comment }) =>
          comment,
      ),

      trakt: traktComments.map(
        ({ score: _score, ...comment }) =>
          comment,
      ),
    },
  });
}
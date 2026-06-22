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

type SocialComment = {
  id: string;
  source: "trakt";

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

  return (
    first?.movie?.ids?.slug ||
    first?.movie?.ids?.trakt ||
    null
  );
}

async function getTraktComments(tmdbId: number) {
  try {
    const traktMovieId =
      await findTraktMovieIdFromTmdb(tmdbId);

    if (!traktMovieId) {
      return [];
    }

    const rawComments = await traktGet<TraktComment[]>(
      `/movies/${encodeURIComponent(
        String(traktMovieId),
      )}/comments/newest`,
      { ttlSeconds: 900, cache: "no-store" },
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

  const traktComments = await getTraktComments(tmdbId);

  const allComments = uniqueById(
    [...traktComments].sort(
      (a, b) => b.score - a.score,
    ),
  );

  return NextResponse.json({
    ok: true,
    usedTmdbApi: false,
    skippedReasons: ["tmdb_reviews_disabled"],

    counts: {
      tmdb: 0,

      trakt: traktComments.length,

      all: allComments.length,
    },

    comments: {
      all: allComments.map(
        ({ score: _score, ...comment }) =>
          comment,
      ),

      tmdb: [],

      trakt: traktComments.map(
        ({ score: _score, ...comment }) =>
          comment,
      ),
    },
  });
}

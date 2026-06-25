import { NextResponse } from "next/server";
import { traktGet } from "@/server/api-clients/trakt/client";
import { translateToPtBr } from "@/server/translate/translate-to-pt-br";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";

export const dynamic = "force-dynamic";

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

function parsePositiveNumber(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
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

async function normalizeComment(comment: TraktComment) {
  const originalComment = comment.comment || "";
  const translation = await translateToPtBr(originalComment);

  return {
    id: comment.id,
    originalComment,
    translatedComment: translation.translatedText,
    displayComment: translation.translatedText || originalComment,
    translationStatus: translation.translated ? "translated" : "original",
    sourceLanguage: translation.sourceLanguage,
    translationError: translation.error ?? null,
    spoiler: Boolean(comment.spoiler),
    review: Boolean(comment.review),
    replies: comment.replies ?? 0,
    likes: comment.likes ?? 0,
    user: {
      username: comment.user?.username ?? "trakt",
      vip: Boolean(comment.user?.vip),
      verified: Boolean(comment.user?.vip_ep),
    },
  };
}

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  try {
    const { searchParams } = new URL(request.url);

    const tmdbId = parsePositiveNumber(searchParams.get("tmdbId"));

    if (!tmdbId) {
      return NextResponse.json(
        {
          error: "Parâmetro tmdbId obrigatório",
          example: "/api/dev/trakt-movie-comments-translated?tmdbId=550",
          total: 0,
          comments: [],
        },
        { status: 400 },
      );
    }

    const traktMovieId = await findTraktMovieIdFromTmdb(tmdbId);

    if (!traktMovieId) {
      return NextResponse.json({
        source: "trakt_movie_comments_translated",
        tmdbId,
        total: 0,
        comments: [],
        warning: "Filme não encontrado no Trakt a partir do TMDB ID",
      });
    }

    const rawComments = await traktGet<TraktComment[]>(
      `/movies/${encodeURIComponent(String(traktMovieId))}/comments/newest`,
      { ttlSeconds: 900, cache: "no-store" },
    );

    const comments = Array.isArray(rawComments)
      ? await Promise.all(rawComments.map(normalizeComment))
      : [];

    return NextResponse.json({
      source: "trakt_movie_comments_translated",
      tmdbId,
      traktMovieId,
      total: comments.length,
      comments,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Erro ao carregar comentários do filme no Trakt",
        message: error instanceof Error ? error.message : "Erro desconhecido",
        total: 0,
        comments: [],
      },
      { status: 500 },
    );
  }
}

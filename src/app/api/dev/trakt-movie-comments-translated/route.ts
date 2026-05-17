import { NextResponse } from "next/server";
import { translateToPtBr } from "@/server/translate/translate-to-pt-br";

export const dynamic = "force-dynamic";

const TRAKT_API_BASE = "https://api.trakt.tv";

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

function getTraktClientId() {
  return process.env.TRAKT_CLIENT_ID || "";
}

function parsePositiveNumber(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
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

  let body: any = null;

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

    const rawComments = await traktFetch(
      `/movies/${encodeURIComponent(String(traktMovieId))}/comments/newest`,
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
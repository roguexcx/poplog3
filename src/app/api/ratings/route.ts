/**
 * /api/ratings
 *
 * Gerencia avaliações pessoais POPLOG do usuário (0–5 estrelas).
 *
 * GET    ?mediaType=movie&tmdbId=123[&seasonNumber=1&episodeNumber=2]
 *   → Retorna a avaliação pessoal do usuário para o item.
 *
 * POST   { mediaType, tmdbId, rating, seasonNumber?, episodeNumber?, ratingSource? }
 *   → Cria ou atualiza a avaliação. Recalcula agregados públicos.
 *
 * DELETE { mediaType, tmdbId, seasonNumber?, episodeNumber? }
 *   → Remove a avaliação. Recalcula agregados públicos.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  getUserRating,
  upsertUserRating,
  deleteUserRating,
} from "@/server/ratings/user-rating-service";
import { getPublicRating } from "@/server/ratings/rating-aggregate-service";
import type { RatingMediaType, RatingSource } from "@/types/user";
import {
  resolveUserStateIdentity,
  userStateIdentityDebug,
} from "@/server/user-state/poplog-user-state-identity";

// ── Validators ────────────────────────────────────────────────────────────────

const VALID_MEDIA_TYPES = new Set<string>(["movie", "tv", "season", "episode"]);
const VALID_SOURCES = new Set<string>([
  "explicit",
  "inferred",
  "imported",
  "system_estimate",
]);

function revalidateRatingConsumers(
  mediaType: RatingMediaType,
  tmdbId: number
) {
  if (mediaType === "episode" || mediaType === "season" || mediaType === "tv") {
    revalidatePath(`/title/tv/${tmdbId}`);
    return;
  }

  revalidatePath(`/title/${mediaType}/${tmdbId}`);
}

async function getMutationRatings(
  mediaType: RatingMediaType,
  tmdbId: number,
  seasonNumber?: number | null,
  episodeNumber?: number | null
) {
  const [communityRating, parentCommunityRating] = await Promise.all([
    getPublicRating(mediaType, tmdbId, seasonNumber, episodeNumber),
    mediaType === "episode" || mediaType === "season"
      ? getPublicRating("tv", tmdbId)
      : Promise.resolve(null),
  ]);

  return { communityRating, parentCommunityRating };
}

function isValidMediaType(v: unknown): v is RatingMediaType {
  return typeof v === "string" && VALID_MEDIA_TYPES.has(v);
}

function isValidSource(v: unknown): v is RatingSource {
  return typeof v === "string" && VALID_SOURCES.has(v);
}

function parseIntParam(v: string | null): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function parseFloatBody(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sp = request.nextUrl.searchParams;
    const mediaType = sp.get("mediaType");
    const tmdbIdRaw = sp.get("tmdbId");
    const seasonNumber = parseIntParam(sp.get("seasonNumber"));
    const episodeNumber = parseIntParam(sp.get("episodeNumber"));
    const debugSource = sp.get("debugSource") === "1";

    if (!isValidMediaType(mediaType)) {
      return NextResponse.json(
        { error: "Parâmetro mediaType inválido" },
        { status: 400 }
      );
    }

    const identity = await resolveUserStateIdentity({
      mediaType,
      poplogId: sp.get("poplogId"),
      tmdbId: tmdbIdRaw,
      imdbId: sp.get("imdbId"),
      slug: sp.get("slug"),
    });
    const tmdbId = identity?.tmdbId;

    if (!tmdbId) {
      return NextResponse.json(
        {
          error: "Parâmetro tmdbId/poplogId inválido",
          ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
        },
        { status: 400 }
      );
    }

    const [userRating, communityRating] = await Promise.all([
      getUserRating(user.id, mediaType, tmdbId, seasonNumber, episodeNumber),
      getPublicRating(mediaType, tmdbId, seasonNumber, episodeNumber),
    ]);

    return NextResponse.json({
      success: true,
      data: { userRating, communityRating },
      ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
    });
  } catch (error) {
    console.error("[RATINGS_GET_ERROR]", error);
    return NextResponse.json(
      { error: "Erro interno ao buscar avaliação" },
      { status: 500 }
    );
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { mediaType, tmdbId, rating, seasonNumber, episodeNumber, ratingSource } = body;
    const debugSource = body.debugSource === true;

    if (!isValidMediaType(mediaType)) {
      return NextResponse.json(
        { error: "Campo mediaType inválido" },
        { status: 400 }
      );
    }

    const identity = await resolveUserStateIdentity({
      mediaType,
      poplogId: body.poplogId,
      tmdbId,
      imdbId: body.imdbId,
      slug: body.slug,
      title: body.title,
      year: body.releaseYear,
    });
    const tmdbIdN = identity?.tmdbId;

    if (!tmdbIdN || tmdbIdN <= 0) {
      return NextResponse.json(
        {
          error: "Campo tmdbId/poplogId inválido",
          ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
        },
        { status: 400 }
      );
    }

    const ratingN = parseFloatBody(rating);

    if (ratingN === null || ratingN < 0 || ratingN > 5) {
      return NextResponse.json(
        { error: "Campo rating deve ser entre 0 e 5" },
        { status: 400 }
      );
    }

    const source: RatingSource =
      ratingSource && isValidSource(ratingSource) ? ratingSource : "explicit";

    const saved = await upsertUserRating({
      userId: user.id,
      mediaType,
      tmdbId: tmdbIdN,
      seasonNumber: seasonNumber ?? null,
      episodeNumber: episodeNumber ?? null,
      rating: ratingN,
      ratingSource: source,
    });

    const mutationRatings = await getMutationRatings(
      mediaType,
      tmdbIdN,
      seasonNumber ?? null,
      episodeNumber ?? null
    );

    revalidateRatingConsumers(mediaType, tmdbIdN);

    return NextResponse.json({
      success: true,
      data: { userRating: saved, ...mutationRatings },
      ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
    });
  } catch (error) {
    console.error("[RATINGS_POST_ERROR]", error);
    return NextResponse.json(
      { error: "Erro interno ao salvar avaliação" },
      { status: 500 }
    );
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { mediaType, tmdbId, seasonNumber, episodeNumber } = body;
    const debugSource = body.debugSource === true;

    if (!isValidMediaType(mediaType)) {
      return NextResponse.json(
        { error: "Campo mediaType inválido" },
        { status: 400 }
      );
    }

    const identity = await resolveUserStateIdentity({
      mediaType,
      poplogId: body.poplogId,
      tmdbId,
      imdbId: body.imdbId,
      slug: body.slug,
    });
    const tmdbIdN = identity?.tmdbId;

    if (!tmdbIdN || tmdbIdN <= 0) {
      return NextResponse.json(
        {
          error: "Campo tmdbId/poplogId inválido",
          ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
        },
        { status: 400 }
      );
    }

    await deleteUserRating({
      userId: user.id,
      mediaType,
      tmdbId: tmdbIdN,
      seasonNumber: seasonNumber ?? null,
      episodeNumber: episodeNumber ?? null,
    });

    const mutationRatings = await getMutationRatings(
      mediaType,
      tmdbIdN,
      seasonNumber ?? null,
      episodeNumber ?? null
    );

    revalidateRatingConsumers(mediaType, tmdbIdN);

    return NextResponse.json({
      success: true,
      data: mutationRatings,
      ...(debugSource ? { debugSource: userStateIdentityDebug(identity) } : {}),
    });
  } catch (error) {
    console.error("[RATINGS_DELETE_ERROR]", error);
    return NextResponse.json(
      { error: "Erro interno ao remover avaliação" },
      { status: 500 }
    );
  }
}

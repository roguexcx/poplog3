import { NextResponse } from "next/server";

import {
  getTitleFeedbackMap,
  getTitleFeedbackState,
  isFeedbackType,
  isMediaType,
  type FeedbackType,
} from "@/lib/personalization/feedback";
import { deleteTitleState } from "@/server/state/user-title-state";
import { invalidateContinuitySectionCache } from "@/server/continuity/continuity-section-cache";
import { applyTitleFeedback } from "@/server/personalization/title-feedback-engine";
import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  deactivateUserTitleFeedback,
  getTitleFeedbackRows,
  getUserTitle,
  removeUserTitle as removeUserTitleRow,
  syncFeedbackFlagsToTitleState,
} from "@/server/repositories";
import { resolveEditorialPolicy } from "@/lib/personalization/editorial-policy";
import type { MediaType } from "@/types/user";
import {
  resolveUserStateIdentity,
  userStateIdentityDebug,
} from "@/server/user-state/poplog-user-state-identity";

type FeedbackPayload = {
  poplogId?: unknown;
  imdbId?: unknown;
  slug?: unknown;
  tmdb_id?: unknown;
  tmdbId?: unknown;
  media_type?: unknown;
  mediaType?: unknown;
  feedback_type?: unknown;
  weight?: unknown;
  reason?: unknown;
  source?: unknown;
  debugSource?: unknown;
};

type ParsedPayload =
  | {
      tmdbId: number;
      mediaType: MediaType;
      feedbackType: FeedbackType;
      weight?: number;
      reason: string | null;
      source: string | null;
      debugSource: boolean;
      debugSourcePayload: ReturnType<typeof userStateIdentityDebug>;
    }
  | { error: string };

async function parsePayload(payload: FeedbackPayload): Promise<ParsedPayload> {
  const mediaType = payload.media_type ?? payload.mediaType;
  const feedbackType = payload.feedback_type ?? "not_interested";
  const debugSource = payload.debugSource === true;

  if (!isMediaType(mediaType)) return { error: "media_type deve ser movie ou tv." };
  if (!isFeedbackType(feedbackType)) return { error: "feedback_type invalido." };

  const identity = await resolveUserStateIdentity({
    mediaType,
    poplogId: payload.poplogId,
    tmdbId: payload.tmdb_id ?? payload.tmdbId,
    imdbId: payload.imdbId,
    slug: payload.slug,
  });

  if (!identity?.tmdbId) return { error: "tmdb_id/poplogId invalido." };

  return {
    tmdbId: identity.tmdbId,
    mediaType,
    feedbackType,
    weight: typeof payload.weight === "number" ? payload.weight : undefined,
    reason: typeof payload.reason === "string" ? payload.reason.slice(0, 240) : null,
    source: typeof payload.source === "string" ? payload.source.slice(0, 120) : null,
    debugSource,
    debugSourcePayload: userStateIdentityDebug(identity),
  };
}

async function getSessionUser() {
  const user = await getCurrentUser();
  return { user };
}

async function readLocalTitleState(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
) {
  const feedbackMap = await getTitleFeedbackMap(userId, tmdbId, mediaType);
  return getTitleFeedbackState(feedbackMap, tmdbId, mediaType);
}

async function resolveLocalConflictBeforeNegativeFeedback(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
) {
  const row = await getUserTitle({ userId, tmdbId, mediaType });
  if (!row.ok) return { canSaveNegative: false, conflict: null, error: row.error };
  if (!row.data) return { canSaveNegative: true, conflict: null, error: null };

  if (row.data.favorite || row.data.status === "watched" || row.data.status === "watching") {
    return { canSaveNegative: false, conflict: "positive_state_kept", error: null };
  }

  if (row.data.status === "watchlist" || row.data.status === "fridge") {
    const removed = await removeUserTitleRow({ userId, tmdbId, mediaType });
    if (!removed.ok) return { canSaveNegative: false, conflict: null, error: removed.error };
    await deleteTitleState(userId, tmdbId, mediaType);
    return { canSaveNegative: true, conflict: "removed_from_watchlist", error: null };
  }

  return { canSaveNegative: true, conflict: null, error: null };
}

async function deleteLocalFeedback(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
  feedbackType: FeedbackType,
) {
  if (feedbackType === "liked" || feedbackType === "disliked") {
    await Promise.all(
      (["liked", "disliked"] as const).map((type) =>
        deactivateUserTitleFeedback({ userId, tmdbId, mediaType, feedbackType: type }),
      ),
    );
  } else {
    const deleted = await deactivateUserTitleFeedback({ userId, tmdbId, mediaType, feedbackType });
    if (!deleted.ok) throw new Error(deleted.error);
  }

  const rows = await getTitleFeedbackRows({ userId, tmdbId, mediaType });
  if (!rows.ok) throw new Error(rows.error);
  const snakeRows = rows.data.map((row) => ({
    id: row.id,
    user_id: row.userId,
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    feedback_type: row.feedbackType,
    weight: Number(row.weight),
    reason: row.reason,
    source: row.source,
    surface: row.surface,
    scope: row.scope,
    section_key: row.sectionKey,
    expires_at: row.expiresAt?.toISOString() ?? null,
    active: row.active,
    metadata: row.metadata as Record<string, unknown>,
    strength: row.strength === null ? null : Number(row.strength),
    confidence: row.confidence === null ? null : Number(row.confidence),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }));
  const editorial = resolveEditorialPolicy({ feedback: snakeRows, legacy: {}, surface: "contextual" });
  await syncFeedbackFlagsToTitleState({
    userId,
    tmdbId,
    mediaType,
    liked: feedbackType === "liked" || feedbackType === "disliked" ? null : undefined,
    hasNegativeFeedback:
      editorial.state.notInterested ||
      editorial.state.disliked ||
      editorial.state.hidden ||
      editorial.state.dismissed,
    isHidden: editorial.state.hidden,
    isBoosted: editorial.state.boosted,
    lastFeedbackType: null,
  });
}

export async function GET(request: Request) {
  const { user } = await getSessionUser();
  if (!user) return NextResponse.json({ titleState: { userFeedback: { notInterested: false } } });

  const params = new URL(request.url).searchParams;
  const parsed = await parsePayload({
    tmdb_id: params.get("tmdb_id"),
    tmdbId: params.get("tmdbId"),
    poplogId: params.get("poplogId"),
    imdbId: params.get("imdbId"),
    slug: params.get("slug"),
    media_type: params.get("media_type"),
    mediaType: params.get("mediaType"),
    feedback_type: params.get("feedback_type") ?? "not_interested",
    debugSource: params.get("debugSource") === "1",
  });

  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const state = await readLocalTitleState(user.id, parsed.tmdbId, parsed.mediaType);
  return NextResponse.json({
    titleState: { userFeedback: state, feedbackConflict: null },
    ...(parsed.debugSource ? { debugSource: parsed.debugSourcePayload } : {}),
  });
}

export async function POST(request: Request) {
  const { user } = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sessao obrigatoria." }, { status: 401 });

  const parsed = await parsePayload(await request.json().catch(() => ({})));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const conflict =
    parsed.feedbackType === "not_interested"
      ? await resolveLocalConflictBeforeNegativeFeedback(user.id, parsed.tmdbId, parsed.mediaType)
      : { canSaveNegative: true, conflict: null, error: null };

  if (conflict.error) {
    return NextResponse.json({ error: "Nao foi possivel sincronizar o feedback." }, { status: 500 });
  }

  if (parsed.feedbackType === "not_interested" && !conflict.canSaveNegative) {
    const state = await readLocalTitleState(user.id, parsed.tmdbId, parsed.mediaType);
    return NextResponse.json({
      titleState: {
        userFeedback: state,
        feedbackConflict: conflict.conflict,
      },
      ...(parsed.debugSource ? { debugSource: parsed.debugSourcePayload } : {}),
    });
  }

  await applyTitleFeedback({
    userId: user.id,
    tmdbId: parsed.tmdbId,
    mediaType: parsed.mediaType,
    command: parsed.feedbackType,
    weight: parsed.weight,
    reason: parsed.reason,
    source: parsed.source,
  });

  const state = await readLocalTitleState(user.id, parsed.tmdbId, parsed.mediaType);
  invalidateContinuitySectionCache(user.id);
  return NextResponse.json({
    titleState: {
      userFeedback: state,
      feedbackConflict: conflict.conflict,
    },
    ...(parsed.debugSource ? { debugSource: parsed.debugSourcePayload } : {}),
  });
}

export async function DELETE(request: Request) {
  const { user } = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sessao obrigatoria." }, { status: 401 });

  const parsed = await parsePayload(await request.json().catch(() => ({})));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  await deleteLocalFeedback(user.id, parsed.tmdbId, parsed.mediaType, parsed.feedbackType);
  const state = await readLocalTitleState(user.id, parsed.tmdbId, parsed.mediaType);
  invalidateContinuitySectionCache(user.id);
  return NextResponse.json({
    titleState: {
      userFeedback: state,
      feedbackConflict: null,
    },
    ...(parsed.debugSource ? { debugSource: parsed.debugSourcePayload } : {}),
  });
}

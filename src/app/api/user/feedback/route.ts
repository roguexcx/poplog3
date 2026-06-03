import { NextResponse } from "next/server";

import {
  getTitleFeedbackMap,
  getTitleFeedbackState,
  isFeedbackType,
  isMediaType,
  normalizeFeedbackWeight,
  type FeedbackType,
} from "@/lib/personalization/feedback";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { deleteTitleState } from "@/server/state/user-title-state";
import { invalidateContinuitySectionCache } from "@/server/continuity/continuity-section-cache";
import { applyTitleFeedback } from "@/server/personalization/title-feedback-engine";
import { isLocalFeedbackEnabled } from "@/server/runtime/local-db-flags";
import {
  deactivateUserTitleFeedback,
  getTitleFeedbackRows,
  getUserTitle,
  removeUserTitle as removeUserTitleRow,
  syncFeedbackFlagsToTitleState,
} from "@/server/repositories";
import { resolveEditorialPolicy } from "@/lib/personalization/editorial-policy";
import type { MediaType } from "@/types/user";

type SupabaseServer = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type FeedbackPayload = {
  tmdb_id?: unknown;
  media_type?: unknown;
  feedback_type?: unknown;
  weight?: unknown;
  reason?: unknown;
  source?: unknown;
};

type ParsedPayload =
  | {
      tmdbId: number;
      mediaType: MediaType;
      feedbackType: FeedbackType;
      weight?: number;
      reason: string | null;
      source: string | null;
    }
  | { error: string };

type DbError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null;

function parsePayload(payload: FeedbackPayload): ParsedPayload {
  const tmdbId = Number(payload.tmdb_id);
  const mediaType = payload.media_type;
  const feedbackType = payload.feedback_type ?? "not_interested";

  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return { error: "tmdb_id invalido." };
  if (!isMediaType(mediaType)) return { error: "media_type deve ser movie ou tv." };
  if (!isFeedbackType(feedbackType)) return { error: "feedback_type invalido." };

  return {
    tmdbId,
    mediaType,
    feedbackType,
    weight: typeof payload.weight === "number" ? payload.weight : undefined,
    reason: typeof payload.reason === "string" ? payload.reason.slice(0, 240) : null,
    source: typeof payload.source === "string" ? payload.source.slice(0, 120) : null,
  };
}

function isMissingFeedbackTableError(error: DbError) {
  return error?.code === "42P01";
}

function isPermissionError(error: DbError) {
  return error?.code === "42501";
}

function dbErrorResponse(action: "save" | "delete" | "read", error: DbError) {
  const setupRequired = isMissingFeedbackTableError(error);
  const permissionRequired = isPermissionError(error);

  console.error(`Erro ao ${action} feedback:`, error);

  return NextResponse.json(
    {
      error: setupRequired
        ? "Tabela user_title_feedback nao encontrada. A migration do feedback precisa ser aplicada no Supabase."
        : permissionRequired
          ? "Sem permissao para acessar user_title_feedback. Verifique os grants da migration."
          : "Nao foi possivel sincronizar o feedback.",
      setupRequired,
      permissionRequired,
      details:
        process.env.NODE_ENV === "development"
          ? {
              code: error?.code,
              message: error?.message,
              hint: error?.hint,
              details: error?.details,
            }
          : undefined,
    },
    { status: setupRequired || permissionRequired ? 503 : 500 },
  );
}

async function getSessionUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

async function resolveConflictBeforeNegativeFeedback(
  supabase: SupabaseServer,
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
) {
  const { data, error } = await supabase
    .from("user_titles")
    .select("id, status, favorite")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .limit(1)
    .maybeSingle();

  if (error) return { canSaveNegative: false, conflict: null, error };
  if (!data) return { canSaveNegative: true, conflict: null, error: null };

  if (data.favorite || data.status === "watched" || data.status === "watching") {
    return { canSaveNegative: false, conflict: "positive_state_kept", error: null };
  }

  if (data.status === "watchlist" || data.status === "fridge") {
    const { error: deleteError } = await supabase.from("user_titles").delete().eq("id", data.id);
    if (deleteError) return { canSaveNegative: false, conflict: null, error: deleteError };
    await deleteTitleState(userId, tmdbId, mediaType);
    return { canSaveNegative: true, conflict: "removed_from_watchlist", error: null };
  }

  return { canSaveNegative: true, conflict: null, error: null };
}

async function saveFeedback(
  supabase: SupabaseServer,
  input: {
    userId: string;
    tmdbId: number;
    mediaType: MediaType;
    feedbackType: FeedbackType;
    weight: number;
    reason: string | null;
    source: string | null;
  },
) {
  const { data: existing, error: findError } = await supabase
    .from("user_title_feedback")
    .select("id")
    .eq("user_id", input.userId)
    .eq("tmdb_id", input.tmdbId)
    .eq("media_type", input.mediaType)
    .eq("feedback_type", input.feedbackType)
    .limit(1)
    .maybeSingle();

  if (findError) return findError;

  if (existing?.id) {
    const { error } = await supabase
      .from("user_title_feedback")
      .update({
        active: true,
        weight: input.weight,
        reason: input.reason,
        source: input.source,
      })
      .eq("id", existing.id);

    return error;
  }

  const { error } = await supabase.from("user_title_feedback").insert({
    user_id: input.userId,
    tmdb_id: input.tmdbId,
    media_type: input.mediaType,
    feedback_type: input.feedbackType,
    active: true,
    weight: input.weight,
    reason: input.reason,
    source: input.source,
  });

  return error;
}

async function readTitleState(
  supabase: SupabaseServer,
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
) {
  const feedbackMap = await getTitleFeedbackMap(userId, tmdbId, mediaType, supabase);
  return getTitleFeedbackState(feedbackMap, tmdbId, mediaType);
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
  const { supabase, user } = await getSessionUser();
  if (!user) return NextResponse.json({ titleState: { userFeedback: { notInterested: false } } });

  const params = new URL(request.url).searchParams;
  const parsed = parsePayload({
    tmdb_id: params.get("tmdb_id"),
    media_type: params.get("media_type"),
    feedback_type: params.get("feedback_type") ?? "not_interested",
  });

  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const state = isLocalFeedbackEnabled()
    ? await readLocalTitleState(user.id, parsed.tmdbId, parsed.mediaType)
    : await readTitleState(supabase, user.id, parsed.tmdbId, parsed.mediaType);
  return NextResponse.json({ titleState: { userFeedback: state, feedbackConflict: null } });
}

export async function POST(request: Request) {
  const { supabase, user } = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sessao obrigatoria." }, { status: 401 });

  const parsed = parsePayload(await request.json().catch(() => ({})));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const conflict =
    parsed.feedbackType === "not_interested"
      ? isLocalFeedbackEnabled()
        ? await resolveLocalConflictBeforeNegativeFeedback(user.id, parsed.tmdbId, parsed.mediaType)
        : await resolveConflictBeforeNegativeFeedback(supabase, user.id, parsed.tmdbId, parsed.mediaType)
      : { canSaveNegative: true, conflict: null, error: null };

  if (conflict.error) {
    if (isLocalFeedbackEnabled()) {
      return NextResponse.json({ error: "Nao foi possivel sincronizar o feedback." }, { status: 500 });
    }
    return dbErrorResponse("save", conflict.error as DbError);
  }

  if (parsed.feedbackType === "not_interested" && !conflict.canSaveNegative) {
    const state = isLocalFeedbackEnabled()
      ? await readLocalTitleState(user.id, parsed.tmdbId, parsed.mediaType)
      : await readTitleState(supabase, user.id, parsed.tmdbId, parsed.mediaType);
    return NextResponse.json({
      titleState: {
        userFeedback: state,
        feedbackConflict: conflict.conflict,
      },
    });
  }

  if (isLocalFeedbackEnabled()) {
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
    });
  }

  // Quando salvar liked ou disliked, remover o tipo oposto para evitar conflito
  if (parsed.feedbackType === "liked" || parsed.feedbackType === "disliked") {
    const conflictingType = parsed.feedbackType === "liked" ? "disliked" : "liked";
    await supabase
      .from("user_title_feedback")
      .update({ active: false })
      .eq("user_id", user.id)
      .eq("tmdb_id", parsed.tmdbId)
      .eq("media_type", parsed.mediaType)
      .eq("feedback_type", conflictingType);
  }

  const error = await saveFeedback(supabase, {
    userId: user.id,
    tmdbId: parsed.tmdbId,
    mediaType: parsed.mediaType,
    feedbackType: parsed.feedbackType,
    weight: normalizeFeedbackWeight(parsed.feedbackType, parsed.weight),
    reason: parsed.reason,
    source: parsed.source,
  });

  if (error) return dbErrorResponse("save", error);

  // Sincroniza user_title_state.liked para que a leitura no carregamento da
  // página (get-title-page-data) reflita o estado correto após F5.
  if (parsed.feedbackType === "liked" || parsed.feedbackType === "disliked") {
    await supabase
      .from("user_title_state")
      .upsert(
        {
          user_id: user.id,
          tmdb_id: parsed.tmdbId,
          media_type: parsed.mediaType,
          liked: parsed.feedbackType === "liked",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,tmdb_id,media_type" },
      );
  }

  const state = await readTitleState(supabase, user.id, parsed.tmdbId, parsed.mediaType);
  invalidateContinuitySectionCache(user.id);
  return NextResponse.json({
    titleState: {
      userFeedback: state,
      feedbackConflict: conflict.conflict,
    },
  });
}

export async function DELETE(request: Request) {
  const { supabase, user } = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sessao obrigatoria." }, { status: 401 });

  const parsed = parsePayload(await request.json().catch(() => ({})));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (isLocalFeedbackEnabled()) {
    await deleteLocalFeedback(user.id, parsed.tmdbId, parsed.mediaType, parsed.feedbackType);
    const state = await readLocalTitleState(user.id, parsed.tmdbId, parsed.mediaType);
    invalidateContinuitySectionCache(user.id);
    return NextResponse.json({
      titleState: {
        userFeedback: state,
        feedbackConflict: null,
      },
    });
  }

  const { error } = await supabase
    .from("user_title_feedback")
    .delete()
    .eq("user_id", user.id)
    .eq("tmdb_id", parsed.tmdbId)
    .eq("media_type", parsed.mediaType)
    .eq("feedback_type", parsed.feedbackType);

  if (error) return dbErrorResponse("delete", error);

  // Zera user_title_state.liked quando o voto é removido
  if (parsed.feedbackType === "liked" || parsed.feedbackType === "disliked") {
    await supabase
      .from("user_title_state")
      .update({ liked: null, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("tmdb_id", parsed.tmdbId)
      .eq("media_type", parsed.mediaType);
  }

  const state = await readTitleState(supabase, user.id, parsed.tmdbId, parsed.mediaType);
  invalidateContinuitySectionCache(user.id);
  return NextResponse.json({
    titleState: {
      userFeedback: state,
      feedbackConflict: null,
    },
  });
}

import { NextResponse } from "next/server";

import {
  getTitleFeedbackMap,
  getTitleFeedbackState,
  isFeedbackType,
  isMediaType,
  normalizeFeedbackWeight,
  type FeedbackType,
} from "@/lib/personalization/feedback";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteTitleState } from "@/server/state/user-title-state";
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
    deleteTitleState(userId, tmdbId, mediaType).catch((err) =>
      console.error("[feedback] deleteTitleState failed", err),
    );
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

  const state = await readTitleState(supabase, user.id, parsed.tmdbId, parsed.mediaType);
  return NextResponse.json({ titleState: { userFeedback: state, feedbackConflict: null } });
}

export async function POST(request: Request) {
  const { supabase, user } = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sessao obrigatoria." }, { status: 401 });

  const parsed = parsePayload(await request.json().catch(() => ({})));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const conflict =
    parsed.feedbackType === "not_interested"
      ? await resolveConflictBeforeNegativeFeedback(supabase, user.id, parsed.tmdbId, parsed.mediaType)
      : { canSaveNegative: true, conflict: null, error: null };

  if (conflict.error) return dbErrorResponse("save", conflict.error);

  if (parsed.feedbackType === "not_interested" && !conflict.canSaveNegative) {
    const state = await readTitleState(supabase, user.id, parsed.tmdbId, parsed.mediaType);
    return NextResponse.json({
      titleState: {
        userFeedback: state,
        feedbackConflict: conflict.conflict,
      },
    });
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

  const state = await readTitleState(supabase, user.id, parsed.tmdbId, parsed.mediaType);
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

  const { error } = await supabase
    .from("user_title_feedback")
    .delete()
    .eq("user_id", user.id)
    .eq("tmdb_id", parsed.tmdbId)
    .eq("media_type", parsed.mediaType)
    .eq("feedback_type", parsed.feedbackType);

  if (error) return dbErrorResponse("delete", error);

  const state = await readTitleState(supabase, user.id, parsed.tmdbId, parsed.mediaType);
  return NextResponse.json({
    titleState: {
      userFeedback: state,
      feedbackConflict: null,
    },
  });
}

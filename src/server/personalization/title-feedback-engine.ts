import {
  getTitleFeedbackState,
  normalizeFeedbackWeight,
  type FeedbackType,
  type UserTitleFeedback,
} from "@/lib/personalization/feedback";
import {
  normalizeEditorialSurface,
  resolveEditorialPolicy,
  type EditorialSurfaceInput,
  type EditorialPolicyResult,
  type LegacyTitleSignals,
} from "@/lib/personalization/editorial-policy";
import type { MediaType } from "@/types/user";

export type TitleFeedbackCommand =
  | FeedbackType
  | "favorite"
  | "unfavorite"
  | "clear_like";

export type ApplyTitleFeedbackInput = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  command: TitleFeedbackCommand;
  weight?: number;
  reason?: string | null;
  source?: string | null;
  surface?: EditorialSurfaceInput;
  scope?: "global" | "surface" | "section" | "session";
  sectionKey?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
  db?: FeedbackEngineDbClient;
};

export type ApplyTitleFeedbackEffect =
  | "feedback_persisted"
  | "feedback_persisted_with_legacy_columns"
  | "state_synced"
  | "state_synced_with_legacy_columns"
  | "event_logged"
  | "legacy_library_sync_deferred";

export type ApplyTitleFeedbackWarning =
  | "favorite_legacy_write_deferred_until_trigger_migration"
  | "legacy_liked_write_deferred_until_trigger_migration"
  | "state_row_missing"
  | "feedback_command_without_feedback_row"
  | "feedback_context_fields_missing"
  | "editorial_state_fields_missing";

export type ApplyTitleFeedbackResult = {
  ok: boolean;
  userFeedback: ReturnType<typeof getTitleFeedbackState>;
  editorial: EditorialPolicyResult;
  legacy: LegacyTitleSignals;
  effects: ApplyTitleFeedbackEffect[];
  warnings: ApplyTitleFeedbackWarning[];
};

type DbErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type DbResult<T = unknown> = {
  data?: T | null;
  error?: DbErrorLike | null;
};

type DbQueryBuilder = PromiseLike<DbResult> & {
  select(columns?: string): DbQueryBuilder;
  eq(column: string, value: unknown): DbQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): DbQueryBuilder;
  maybeSingle(): Promise<DbResult>;
  upsert(row: Record<string, unknown>, options?: { onConflict?: string }): Promise<DbResult>;
  update(row: Record<string, unknown>): DbQueryBuilder;
  insert(row: Record<string, unknown>): Promise<DbResult>;
};

export type FeedbackEngineDbClient = {
  from(table: string): DbQueryBuilder;
};

export type PreviewTitleFeedbackInput = Pick<
  ApplyTitleFeedbackInput,
  "userId" | "tmdbId" | "mediaType" | "command" | "weight" | "surface"
> & {
  legacy?: LegacyTitleSignals | null;
  feedback?: UserTitleFeedback[];
};

type LibraryRow = {
  status: string | null;
  favorite: boolean | null;
  liked: boolean | null;
};

type StateRow = {
  status: string | null;
  favorite: boolean | null;
  liked: boolean | null;
};

async function getLocalFeedbackService() {
  return import("@/server/local-services/feedback-local.service");
}

function isPersistedFeedbackCommand(command: TitleFeedbackCommand): command is FeedbackType {
  return !["favorite", "unfavorite", "clear_like"].includes(command);
}

function likedValueForCommand(command: TitleFeedbackCommand): boolean | null | undefined {
  if (command === "liked") return true;
  if (command === "disliked") return false;
  if (command === "clear_like") return null;
  return undefined;
}

function favoriteValueForCommand(command: TitleFeedbackCommand): boolean | undefined {
  if (command === "favorite") return true;
  if (command === "unfavorite") return false;
  return undefined;
}

function isMissingColumnError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42703"
  );
}

function mergeLegacySignals(library: LibraryRow | null, state: StateRow | null): LegacyTitleSignals {
  return {
    status: state?.status ?? library?.status ?? null,
    favorite: state?.favorite ?? library?.favorite ?? false,
    liked: state?.liked ?? library?.liked ?? null,
  };
}

function applyCommandToLegacy(
  legacy: LegacyTitleSignals,
  command: TitleFeedbackCommand,
): LegacyTitleSignals {
  return {
    ...legacy,
    favorite: favoriteValueForCommand(command) ?? legacy.favorite ?? false,
    liked: likedValueForCommand(command) ?? legacy.liked ?? null,
  };
}

function projectFeedbackRows(input: PreviewTitleFeedbackInput): UserTitleFeedback[] {
  const feedback = [...(input.feedback ?? [])];
  if (!isPersistedFeedbackCommand(input.command)) return feedback;

  const now = new Date().toISOString();
  const nextRow: UserTitleFeedback = {
    id: `preview:${input.mediaType}:${input.tmdbId}:${input.command}`,
    user_id: input.userId,
    tmdb_id: input.tmdbId,
    media_type: input.mediaType,
    feedback_type: input.command,
    weight: normalizeFeedbackWeight(input.command, input.weight),
    reason: null,
    source: "preview",
    surface: normalizeEditorialSurface(input.surface),
    scope: "global",
    section_key: null,
    expires_at: null,
    active: true,
    metadata: {},
    strength: null,
    confidence: null,
    created_at: now,
    updated_at: now,
  };

  return [
    nextRow,
    ...feedback.filter((row) => row.feedback_type !== input.command),
  ];
}

export function previewTitleFeedbackApplication(input: PreviewTitleFeedbackInput): {
  userFeedback: ReturnType<typeof getTitleFeedbackState>;
  editorial: EditorialPolicyResult;
  legacy: LegacyTitleSignals;
} {
  const legacy = applyCommandToLegacy(input.legacy ?? {}, input.command);
  const feedbackRows = projectFeedbackRows(input);
  const feedbackMap = new Map([[`${input.mediaType}:${input.tmdbId}`, feedbackRows]]);

  return {
    userFeedback: getTitleFeedbackState(feedbackMap, input.tmdbId, input.mediaType),
    editorial: resolveEditorialPolicy({
      feedback: feedbackRows,
      legacy,
      surface: input.surface,
    }),
    legacy,
  };
}

async function readLegacySignals(
  db: FeedbackEngineDbClient,
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<{ library: LibraryRow | null; state: StateRow | null; legacy: LegacyTitleSignals }> {
  const [libraryResult, stateResult] = await Promise.all([
    db
      .from("user_titles")
      .select("status, favorite, liked")
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType)
      .maybeSingle(),
    db
      .from("user_title_state")
      .select("status, favorite, liked")
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType)
      .maybeSingle(),
  ]);

  const library = (libraryResult.data as LibraryRow | null) ?? null;
  const state = (stateResult.data as StateRow | null) ?? null;

  return {
    library,
    state,
    legacy: mergeLegacySignals(library, state),
  };
}

async function readFeedbackRows(
  db: FeedbackEngineDbClient,
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<UserTitleFeedback[]> {
  const { data, error } = await db
    .from("user_title_feedback")
    .select("*")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as UserTitleFeedback[];
}

async function persistFeedback(
  db: FeedbackEngineDbClient,
  input: ApplyTitleFeedbackInput,
): Promise<"persisted" | "legacy_columns" | "skipped"> {
  if (!isPersistedFeedbackCommand(input.command)) return "skipped";

  const surface = normalizeEditorialSurface(input.surface);
  const baseRow = {
    user_id: input.userId,
    tmdb_id: input.tmdbId,
    media_type: input.mediaType,
    feedback_type: input.command,
    weight: normalizeFeedbackWeight(input.command, input.weight),
    reason: input.reason?.slice(0, 240) ?? null,
    source: input.source?.slice(0, 120) ?? null,
  };

  const { error } = await db
    .from("user_title_feedback")
    .upsert(
      {
        ...baseRow,
        surface,
        scope: input.scope ?? (input.sectionKey ? "section" : "global"),
        section_key: input.sectionKey?.slice(0, 160) ?? null,
        expires_at: input.expiresAt ?? null,
        active: true,
        metadata: input.metadata ?? {},
      },
      { onConflict: "user_id,tmdb_id,media_type,feedback_type" },
    );

  if (!error) return "persisted";
  if (!isMissingColumnError(error)) throw error;

  const { error: legacyError } = await db
    .from("user_title_feedback")
    .upsert(baseRow, { onConflict: "user_id,tmdb_id,media_type,feedback_type" });

  if (legacyError) throw legacyError;
  return "legacy_columns";
}

async function syncMaterializedState(
  db: FeedbackEngineDbClient,
  input: ApplyTitleFeedbackInput,
  stateExists: boolean,
  editorial: EditorialPolicyResult,
): Promise<"synced" | "legacy_columns" | "missing" | "noop"> {
  const patch: Record<string, unknown> = {
    editorial_affinity: Math.max(editorial.baseScore, 0),
    editorial_penalty: Math.abs(Math.min(editorial.baseScore, 0)),
    editorial_score: editorial.baseScore,
    has_negative_feedback:
      editorial.state.notInterested ||
      editorial.state.disliked ||
      editorial.state.hidden ||
      editorial.state.dismissed,
    is_hidden: editorial.state.hidden,
    is_boosted: editorial.state.boosted,
    last_feedback_type: input.command,
    last_feedback_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const liked = likedValueForCommand(input.command);
  const favorite = favoriteValueForCommand(input.command);
  const legacyPatch: Record<string, unknown> = {
    user_id: input.userId,
    tmdb_id: input.tmdbId,
    media_type: input.mediaType,
    updated_at: patch.updated_at,
  };
  const identity = {
    user_id: input.userId,
    tmdb_id: input.tmdbId,
    media_type: input.mediaType,
  };

  if (liked !== undefined) {
    patch.liked = liked;
    legacyPatch.liked = liked;
  }
  if (favorite !== undefined) {
    patch.favorite = favorite;
    legacyPatch.favorite = favorite;
  }

  if (Object.keys(patch).length === 1) return "noop";

  const { error } = stateExists
    ? await db
        .from("user_title_state")
        .update(patch)
        .eq("user_id", input.userId)
        .eq("tmdb_id", input.tmdbId)
        .eq("media_type", input.mediaType)
    : await db
        .from("user_title_state")
        .upsert({ ...identity, ...patch }, { onConflict: "user_id,tmdb_id,media_type" });

  if (!error) return "synced";
  if (!isMissingColumnError(error)) throw error;

  if (Object.keys(legacyPatch).length === 4) return "noop";

  const { error: legacyError } = stateExists
    ? await db
        .from("user_title_state")
        .update(legacyPatch)
        .eq("user_id", input.userId)
        .eq("tmdb_id", input.tmdbId)
        .eq("media_type", input.mediaType)
    : await db
        .from("user_title_state")
        .upsert(legacyPatch, { onConflict: "user_id,tmdb_id,media_type" });

  if (legacyError) throw legacyError;
  return "legacy_columns";
}

async function logFeedbackEvent(
  db: FeedbackEngineDbClient,
  input: ApplyTitleFeedbackInput,
  editorial: EditorialPolicyResult,
  effects: ApplyTitleFeedbackEffect[],
  warnings: ApplyTitleFeedbackWarning[],
): Promise<void> {
  const { error } = await db.from("user_events").insert({
    user_id: input.userId,
    tmdb_id: input.tmdbId,
    media_type: input.mediaType,
    event_type: "feedback_applied",
    payload: {
      command: input.command,
      weight: input.weight ?? null,
      reason: input.reason ?? null,
      source: input.source ?? null,
      surface: editorial.surface,
      requestedSurface: input.surface ?? null,
      scope: input.scope ?? (input.sectionKey ? "section" : "global"),
      sectionKey: input.sectionKey ?? null,
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? {},
      editorial: {
        score: editorial.surfaceScore,
        baseScore: editorial.baseScore,
        persistenceScore: editorial.persistenceScore,
        decayResistance: editorial.decayResistance,
        state: editorial.state,
        explanation: editorial.explanation,
      },
      effects,
      warnings,
    },
  });

  if (error) throw error;
}

export async function applyTitleFeedback(
  input: ApplyTitleFeedbackInput,
): Promise<ApplyTitleFeedbackResult> {
  if (!input.db) {
    const local = await getLocalFeedbackService();
    return local.applyTitleFeedback(input as Parameters<typeof local.applyTitleFeedback>[0]) as Promise<ApplyTitleFeedbackResult>;
  }

  const effects: ApplyTitleFeedbackEffect[] = [];
  const warnings: ApplyTitleFeedbackWarning[] = [];
  const db = input.db;

  const initial = await readLegacySignals(db, input.userId, input.tmdbId, input.mediaType);
  const projectedLegacy = applyCommandToLegacy(initial.legacy, input.command);

  const persisted = await persistFeedback(db, input);
  if (persisted === "persisted") {
    effects.push("feedback_persisted");
  } else if (persisted === "legacy_columns") {
    effects.push("feedback_persisted_with_legacy_columns");
    warnings.push("feedback_context_fields_missing");
  } else {
    warnings.push("feedback_command_without_feedback_row");
  }

  if (input.command === "favorite" || input.command === "unfavorite") {
    effects.push("legacy_library_sync_deferred");
    warnings.push("favorite_legacy_write_deferred_until_trigger_migration");
  }

  if (likedValueForCommand(input.command) !== undefined) {
    effects.push("legacy_library_sync_deferred");
    warnings.push("legacy_liked_write_deferred_until_trigger_migration");
  }

  const feedbackRows = await readFeedbackRows(db, input.userId, input.tmdbId, input.mediaType);
  const feedbackMap = new Map([[`${input.mediaType}:${input.tmdbId}`, feedbackRows]]);
  const userFeedback = getTitleFeedbackState(feedbackMap, input.tmdbId, input.mediaType);
  const editorial = resolveEditorialPolicy({
    feedback: feedbackRows,
    legacy: projectedLegacy,
    surface: input.surface,
  });

  const syncResult = await syncMaterializedState(db, input, initial.state !== null, editorial);
  if (syncResult === "synced") effects.push("state_synced");
  if (syncResult === "legacy_columns") {
    effects.push("state_synced_with_legacy_columns");
    warnings.push("editorial_state_fields_missing");
  }
  if (syncResult === "missing") warnings.push("state_row_missing");

  await logFeedbackEvent(db, input, editorial, effects, warnings);
  effects.push("event_logged");

  return {
    ok: true,
    userFeedback,
    editorial,
    legacy: projectedLegacy,
    effects: [...new Set(effects)],
    warnings: [...new Set(warnings)],
  };
}

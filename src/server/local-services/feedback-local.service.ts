import {
  buildUserFeedbackKey,
  createUserEvent,
  deactivateUserTitleFeedback,
  getTitleFeedbackRows,
  getUserActiveFeedbackMap,
  getUserTitle,
  saveUserTitleFeedback,
  syncFeedbackFlagsToTitleState,
} from "@/server/repositories";
import {
  getTitleFeedbackState,
  normalizeFeedbackWeight,
  type FeedbackType,
  type UserFeedbackMap,
  type UserTitleFeedback,
} from "@/lib/personalization/feedback";
import {
  normalizeEditorialSurface,
  resolveEditorialPolicy,
  type EditorialPolicyResult,
  type EditorialSurfaceInput,
  type LegacyTitleSignals,
} from "@/lib/personalization/editorial-policy";
import type { MediaType } from "@/types/user";
import type { FeedbackScope, FeedbackSurface, UserTitleFeedback as PrismaFeedbackRow } from "@prisma/client";

export type TitleFeedbackCommand = FeedbackType | "favorite" | "unfavorite" | "clear_like" | "dismissed";

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
};

export type ApplyTitleFeedbackEffect =
  | "feedback_persisted"
  | "state_synced"
  | "event_logged"
  | "legacy_library_sync_deferred";

export type ApplyTitleFeedbackWarning =
  | "favorite_legacy_write_deferred_until_trigger_migration"
  | "legacy_liked_write_deferred_until_trigger_migration"
  | "feedback_command_without_feedback_row";

export type ApplyTitleFeedbackResult = {
  ok: boolean;
  userFeedback: ReturnType<typeof getTitleFeedbackState>;
  editorial: EditorialPolicyResult;
  legacy: LegacyTitleSignals;
  effects: ApplyTitleFeedbackEffect[];
  warnings: ApplyTitleFeedbackWarning[];
};

function toSnakeFeedback(row: PrismaFeedbackRow): UserTitleFeedback {
  return {
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
  };
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

function isPersistedFeedbackCommand(command: TitleFeedbackCommand): command is FeedbackType | "dismissed" {
  return !["favorite", "unfavorite", "clear_like"].includes(command);
}

function buildFeedbackMap(rows: PrismaFeedbackRow[], tmdbId: number, mediaType: MediaType): UserFeedbackMap {
  return new Map([[buildUserFeedbackKey(tmdbId, mediaType), rows.map(toSnakeFeedback)]]);
}

async function readLegacy(userId: string, tmdbId: number, mediaType: MediaType): Promise<LegacyTitleSignals> {
  const row = await getUserTitle({ userId, tmdbId, mediaType });
  if (!row.ok || !row.data) return {};
  return {
    status: row.data.status,
    favorite: row.data.favorite,
    liked: row.data.liked,
  };
}

export async function getTitleFeedbackMap(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<UserFeedbackMap> {
  const result = await getTitleFeedbackRows({ userId, tmdbId, mediaType });
  if (!result.ok) return new Map();
  return buildFeedbackMap(result.data, tmdbId, mediaType);
}

export async function getUserFeedbackMap(userId: string | null | undefined): Promise<UserFeedbackMap> {
  if (!userId) return new Map();
  const result = await getUserActiveFeedbackMap(userId);
  if (!result.ok) return new Map();
  const map: UserFeedbackMap = new Map();
  for (const [key, rows] of result.data.entries()) {
    map.set(key, rows.map(toSnakeFeedback));
  }
  return map;
}

export async function removeNegativeFeedbackForTitle(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<void> {
  await Promise.all(
    (["not_interested", "disliked", "hidden"] as const).map((feedbackType) =>
      deactivateUserTitleFeedback({ userId, tmdbId, mediaType, feedbackType }),
    ),
  );
}

export async function applyTitleFeedback(
  input: ApplyTitleFeedbackInput,
): Promise<ApplyTitleFeedbackResult> {
  const effects: ApplyTitleFeedbackEffect[] = [];
  const warnings: ApplyTitleFeedbackWarning[] = [];
  const legacy = await readLegacy(input.userId, input.tmdbId, input.mediaType);
  const liked = likedValueForCommand(input.command);
  const favorite = favoriteValueForCommand(input.command);

  if (isPersistedFeedbackCommand(input.command)) {
    const feedbackType = input.command === "dismissed" ? "dismissed_from_section" : input.command;
    const persisted = await saveUserTitleFeedback({
      userId: input.userId,
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      feedbackType: input.command,
      weight: normalizeFeedbackWeight(feedbackType, input.weight),
      reason: input.reason ?? null,
      source: input.source ?? null,
      surface: normalizeEditorialSurface(input.surface) as FeedbackSurface | null,
      scope: input.scope as FeedbackScope | undefined,
      sectionKey: input.sectionKey ?? null,
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? {},
    });
    if (!persisted.ok) throw new Error(persisted.error);
    effects.push("feedback_persisted");
  } else {
    warnings.push("feedback_command_without_feedback_row");
  }

  if (liked !== undefined || favorite !== undefined || isPersistedFeedbackCommand(input.command)) {
    const rows = await getTitleFeedbackRows({
      userId: input.userId,
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
    });
    if (!rows.ok) throw new Error(rows.error);
    const feedbackRows = rows.data.map(toSnakeFeedback);
    const editorial = resolveEditorialPolicy({
      feedback: feedbackRows,
      legacy: {
        ...legacy,
        liked: liked === undefined ? legacy.liked : liked,
        favorite: favorite === undefined ? legacy.favorite : favorite,
      },
      surface: input.surface,
    });

    const sync = await syncFeedbackFlagsToTitleState({
      userId: input.userId,
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      liked,
      favorite,
      hasNegativeFeedback:
        editorial.state.notInterested ||
        editorial.state.disliked ||
        editorial.state.hidden ||
        editorial.state.dismissed,
      isHidden: editorial.state.hidden,
      isBoosted: editorial.state.boosted,
      lastFeedbackType: input.command,
    });
    if (!sync.ok) throw new Error(sync.error);
    effects.push("state_synced");

    const event = await createUserEvent({
      userId: input.userId,
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      eventType: "feedback_applied",
      payload: {
        command: input.command,
        weight: input.weight ?? null,
        reason: input.reason ?? null,
        source: input.source ?? null,
        surface: editorial.surface,
        scope: input.scope ?? (input.sectionKey ? "section" : "global"),
        sectionKey: input.sectionKey ?? null,
        metadata: input.metadata ?? {},
        editorial: {
          score: editorial.surfaceScore,
          baseScore: editorial.baseScore,
          state: editorial.state,
        },
      },
    });
    if (event.ok) effects.push("event_logged");

    if (input.command === "favorite" || input.command === "unfavorite") {
      effects.push("legacy_library_sync_deferred");
      warnings.push("favorite_legacy_write_deferred_until_trigger_migration");
    }
    if (liked !== undefined) {
      effects.push("legacy_library_sync_deferred");
      warnings.push("legacy_liked_write_deferred_until_trigger_migration");
    }

    const map = buildFeedbackMap(rows.data, input.tmdbId, input.mediaType);
    return {
      ok: true,
      userFeedback: getTitleFeedbackState(map, input.tmdbId, input.mediaType),
      editorial,
      legacy,
      effects: [...new Set(effects)],
      warnings: [...new Set(warnings)],
    };
  }

  const emptyEditorial = resolveEditorialPolicy({ feedback: [], legacy, surface: input.surface });
  return {
    ok: true,
    userFeedback: { notInterested: false, activeFeedbackTypes: [] },
    editorial: emptyEditorial,
    legacy,
    effects: [...new Set(effects)],
    warnings: [...new Set(warnings)],
  };
}

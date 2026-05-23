import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  applyTitleFeedback,
  previewTitleFeedbackApplication,
  type FeedbackEngineDbClient,
  type TitleFeedbackCommand,
} from "../src/server/personalization/title-feedback-engine";
import type { FeedbackType, UserTitleFeedback } from "../src/lib/personalization/feedback";
import type { MediaType } from "../src/types/user";

type Row = Record<string, unknown>;
type DbResult = { data?: unknown; error?: { code?: string; message?: string } | null };

const USER_ID = "00000000-0000-0000-0000-000000000001";
const NOW = "2026-05-22T00:00:00.000Z";

class MemoryQuery implements PromiseLike<DbResult> {
  private filters: Array<[string, unknown]> = [];
  private mode: "select" | "update" | null = null;
  private updatePatch: Row | null = null;

  constructor(
    private readonly db: MemoryFeedbackDb,
    private readonly table: string,
  ) {}

  select(): this {
    this.mode = "select";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  order(): this {
    return this;
  }

  async maybeSingle(): Promise<DbResult> {
    const rows = this.matchingRows();
    return { data: rows[0] ?? null, error: null };
  }

  async upsert(row: Row, options?: { onConflict?: string }): Promise<DbResult> {
    const missing = this.db.findMissingColumn(row);
    if (missing) return { data: null, error: { code: "42703", message: `missing ${missing}` } };

    const rows = this.db.table(this.table);
    const conflictColumns = (options?.onConflict ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const existing = rows.find((candidate) =>
      conflictColumns.every((column) => candidate[column] === row[column]),
    );

    if (existing) Object.assign(existing, row, { updated_at: NOW });
    else rows.push({ id: `${this.table}:${rows.length + 1}`, created_at: NOW, updated_at: NOW, ...row });

    return { data: null, error: null };
  }

  update(row: Row): this {
    this.mode = "update";
    this.updatePatch = row;
    return this;
  }

  async insert(row: Row): Promise<DbResult> {
    const rows = this.db.table(this.table);
    rows.push({ id: `${this.table}:${rows.length + 1}`, created_at: NOW, ...row });
    return { data: null, error: null };
  }

  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<DbResult> {
    if (this.mode === "update" && this.updatePatch) {
      const missing = this.db.findMissingColumn(this.updatePatch);
      if (missing) return { data: null, error: { code: "42703", message: `missing ${missing}` } };

      for (const row of this.matchingRows()) Object.assign(row, this.updatePatch);
      return { data: null, error: null };
    }

    return { data: this.matchingRows(), error: null };
  }

  private matchingRows(): Row[] {
    return this.db.table(this.table).filter((row) =>
      this.filters.every(([column, value]) => row[column] === value),
    );
  }
}

class MemoryFeedbackDb implements FeedbackEngineDbClient {
  readonly tables: Record<string, Row[]> = {
    user_titles: [],
    user_title_state: [],
    user_title_feedback: [],
    user_events: [],
  };

  constructor(private readonly missingColumns = new Set<string>()) {}

  from(table: string): ReturnType<FeedbackEngineDbClient["from"]> {
    return new MemoryQuery(this, table) as ReturnType<FeedbackEngineDbClient["from"]>;
  }

  table(name: string): Row[] {
    this.tables[name] ??= [];
    return this.tables[name];
  }

  findMissingColumn(row: Row): string | null {
    for (const column of Object.keys(row)) {
      if (this.missingColumns.has(column)) return column;
    }
    return null;
  }

  seedTitle(input: {
    tmdbId: number;
    mediaType?: MediaType;
    status: string;
    favorite?: boolean;
    liked?: boolean | null;
  }) {
    const mediaType = input.mediaType ?? "movie";
    this.table("user_titles").push({
      id: `title:${input.tmdbId}`,
      user_id: USER_ID,
      tmdb_id: input.tmdbId,
      media_type: mediaType,
      status: input.status,
      favorite: input.favorite ?? false,
      liked: input.liked ?? null,
    });
    this.table("user_title_state").push({
      id: `state:${input.tmdbId}`,
      user_id: USER_ID,
      tmdb_id: input.tmdbId,
      media_type: mediaType,
      status: input.status,
      favorite: input.favorite ?? false,
      liked: input.liked ?? null,
    });
  }

  feedbackFor(tmdbId: number): Row[] {
    return this.table("user_title_feedback").filter((row) => row.tmdb_id === tmdbId);
  }

  stateFor(tmdbId: number): Row {
    const row = this.table("user_title_state").find((state) => state.tmdb_id === tmdbId);
    assert.ok(row, `state not found for ${tmdbId}`);
    return row;
  }

  eventFor(tmdbId: number): Row {
    const row = this.table("user_events").find((event) => event.tmdb_id === tmdbId);
    assert.ok(row, `event not found for ${tmdbId}`);
    return row;
  }
}

function checkMigration() {
  const migrationPath = resolve("supabase/migrations/20260522000100_feedback_engine_schema.sql");
  const sql = readFileSync(migrationPath, "utf8");

  const requiredSnippets = [
    "create table if not exists public.user_title_feedback",
    "add column if not exists surface text",
    "add column if not exists scope text not null default 'global'",
    "add column if not exists active boolean not null default true",
    "add column if not exists metadata jsonb not null default '{}'",
    "surface = case when surface = 'agenda' then 'radar' else surface end",
    "add column if not exists editorial_affinity numeric not null default 0",
    "add column if not exists editorial_penalty numeric not null default 0",
    "add column if not exists editorial_score numeric not null default 0",
    "create index if not exists user_title_feedback_active_lookup_idx",
    "create index if not exists user_title_state_editorial_score_idx",
    "create or replace function public.neutralize_negative_feedback_on_positive_title_state()",
    "return new;",
  ];

  for (const snippet of requiredSnippets) assert.ok(sql.includes(snippet), `missing SQL: ${snippet}`);
  assert.ok(!/delete\s+from\s+public\.user_title_feedback/i.test(sql), "migration must not delete feedback");
  assert.ok(!/drop\s+table/i.test(sql), "migration must not drop tables");
  assert.ok(!/drop\s+column/i.test(sql), "migration must not drop columns");
}

function checkPolicyPreview() {
  const commands: TitleFeedbackCommand[] = [
    "liked",
    "disliked",
    "favorite",
    "unfavorite",
    "not_interested",
    "hidden",
    "boosted",
    "dismissed_from_section",
  ];

  for (const command of commands) {
    const result = previewTitleFeedbackApplication({
      userId: USER_ID,
      tmdbId: 10,
      mediaType: "movie",
      command,
      surface: "agenda",
    });
    assert.equal(result.editorial.surface, "radar", `${command}: agenda should normalize to radar`);
    assert.ok(Number.isFinite(result.editorial.baseScore), `${command}: score should be finite`);
  }

  const favorite = previewTitleFeedbackApplication({
    userId: USER_ID,
    tmdbId: 11,
    mediaType: "movie",
    command: "favorite",
    legacy: { liked: true },
    feedback: feedbackRows(11, ["not_interested", "disliked"]),
  });
  const liked = previewTitleFeedbackApplication({
    userId: USER_ID,
    tmdbId: 12,
    mediaType: "movie",
    command: "liked",
  });
  const hidden = previewTitleFeedbackApplication({
    userId: USER_ID,
    tmdbId: 13,
    mediaType: "movie",
    command: "hidden",
    surface: "for_you",
  });

  assert.equal(favorite.editorial.state.favorite, true);
  assert.equal(favorite.editorial.state.disliked, false);
  assert.equal(favorite.editorial.state.notInterested, false);
  assert.ok(favorite.editorial.baseScore > liked.editorial.baseScore, "favorite > liked");
  assert.ok(
    favorite.editorial.persistenceScore > liked.editorial.persistenceScore,
    "favorite persistenceScore > liked",
  );
  assert.ok(
    favorite.editorial.decayResistance > liked.editorial.decayResistance,
    "favorite decayResistance > liked",
  );
  assert.equal(hidden.editorial.shouldExclude, true, "hidden should be restrictive");
}

async function checkApplyTitleFeedbackWithMigratedSchema() {
  const db = new MemoryFeedbackDb();

  db.seedTitle({ tmdbId: 101, status: "watchlist", favorite: true });
  await applyTitleFeedback({
    db,
    userId: USER_ID,
    tmdbId: 101,
    mediaType: "movie",
    command: "not_interested",
    surface: "agenda",
  });
  assert.equal(db.feedbackFor(101).length, 1, "not_interested on favorite must preserve raw feedback");
  assert.equal(db.stateFor(101).favorite, true, "favorite must remain in state");
  assert.equal(db.stateFor(101).has_negative_feedback, false, "favorite neutralizes negative in derived state");
  assert.equal((db.eventFor(101).payload as Row).surface, "radar");
  assert.equal((db.eventFor(101).payload as Row).requestedSurface, "agenda");

  db.seedTitle({ tmdbId: 102, status: "watchlist" });
  await applyTitleFeedback({ db, userId: USER_ID, tmdbId: 102, mediaType: "movie", command: "not_interested" });
  assert.equal(db.feedbackFor(102).length, 1, "watchlist not_interested must preserve feedback");
  assert.equal(db.stateFor(102).status, "watchlist", "watchlist status must not be destroyed");

  db.seedTitle({ tmdbId: 103, status: "watched" });
  await applyTitleFeedback({ db, userId: USER_ID, tmdbId: 103, mediaType: "movie", command: "not_interested" });
  assert.equal(db.stateFor(103).status, "watched", "watched status must not be destroyed");

  db.seedTitle({ tmdbId: 104, mediaType: "tv", status: "watching" });
  await applyTitleFeedback({ db, userId: USER_ID, tmdbId: 104, mediaType: "tv", command: "not_interested" });
  assert.equal(db.stateFor(104).status, "watching", "watching status must not be destroyed");

  db.seedTitle({ tmdbId: 105, status: "watchlist" });
  await applyTitleFeedback({ db, userId: USER_ID, tmdbId: 105, mediaType: "movie", command: "liked" });
  assert.equal(db.stateFor(105).status, "watchlist", "liked must not mark watched");
  assert.equal(db.stateFor(105).liked, true);

  db.seedTitle({ tmdbId: 106, status: "watchlist" });
  await applyTitleFeedback({ db, userId: USER_ID, tmdbId: 106, mediaType: "movie", command: "disliked" });
  assert.equal(db.stateFor(106).status, "watchlist", "disliked must not mark watched");
  assert.equal(db.stateFor(106).liked, false);

  db.seedTitle({ tmdbId: 107, status: "watchlist" });
  await applyTitleFeedback({ db, userId: USER_ID, tmdbId: 107, mediaType: "movie", command: "not_interested" });
  await applyTitleFeedback({ db, userId: USER_ID, tmdbId: 107, mediaType: "movie", command: "favorite" });
  assert.equal(db.feedbackFor(107).length, 1, "favorite must not delete raw negative feedback");
  assert.equal(db.stateFor(107).favorite, true);
  assert.equal(db.stateFor(107).editorial_score, 100);
  assert.equal(db.stateFor(107).has_negative_feedback, false);

  db.seedTitle({ tmdbId: 108, status: "watchlist" });
  await applyTitleFeedback({ db, userId: USER_ID, tmdbId: 108, mediaType: "movie", command: "hidden", surface: "for_you" });
  assert.equal(db.stateFor(108).is_hidden, true, "hidden flag should be derived");
  assert.equal(db.stateFor(108).editorial_score, -1000, "hidden should be most restrictive");

  db.seedTitle({ tmdbId: 109, status: "watchlist" });
  await applyTitleFeedback({ db, userId: USER_ID, tmdbId: 109, mediaType: "movie", command: "boosted" });
  assert.equal(db.stateFor(109).is_boosted, true);

  db.seedTitle({ tmdbId: 110, status: "watchlist" });
  await applyTitleFeedback({
    db,
    userId: USER_ID,
    tmdbId: 110,
    mediaType: "movie",
    command: "dismissed_from_section",
    surface: "agenda",
    sectionKey: "today",
  });
  assert.equal(db.feedbackFor(110)[0].surface, "radar");
  assert.equal(db.feedbackFor(110)[0].section_key, "today");
}

async function checkLegacyFallback() {
  const missingColumns = new Set([
    "surface",
    "scope",
    "section_key",
    "expires_at",
    "active",
    "metadata",
    "editorial_affinity",
    "editorial_penalty",
    "editorial_score",
    "has_negative_feedback",
    "is_hidden",
    "is_boosted",
    "last_feedback_type",
    "last_feedback_at",
  ]);
  const db = new MemoryFeedbackDb(missingColumns);
  db.seedTitle({ tmdbId: 201, status: "watchlist" });

  const result = await applyTitleFeedback({
    db,
    userId: USER_ID,
    tmdbId: 201,
    mediaType: "movie",
    command: "liked",
    surface: "agenda",
  });

  assert.ok(result.effects.includes("feedback_persisted_with_legacy_columns"));
  assert.ok(result.effects.includes("state_synced_with_legacy_columns"));
  assert.ok(result.warnings.includes("feedback_context_fields_missing"));
  assert.ok(result.warnings.includes("editorial_state_fields_missing"));
  assert.equal(db.stateFor(201).liked, true);
}

function checkEndpointSource() {
  const route = readFileSync(resolve("src/app/api/user/feedback/route.ts"), "utf8");
  assert.ok(route.includes("applyTitleFeedback"), "POST endpoint must call applyTitleFeedback");
  assert.ok(route.includes(".update({ active: false })"), "DELETE should prefer active=false");
  assert.ok(
    !/from\("user_titles"\)[\s\S]*\.\s*delete/.test(route),
    "endpoint must not delete user_titles",
  );
  assert.ok(!/status:\s*\"watched\"/.test(route), "endpoint must not mark watched");
}

function checkHookAndCardSource() {
  const hook = readFileSync(resolve("src/hooks/useUserFeedbackToggle.ts"), "utf8");
  const button = readFileSync(resolve("src/components/ui/CardActionButton.tsx"), "utf8");
  const titleActions = readFileSync(resolve("src/features/title/TitleActions.tsx"), "utf8");
  const userTitleService = readFileSync(resolve("src/lib/user-title-service.ts"), "utf8");
  const libraryRoute = readFileSync(resolve("src/app/api/library/title/route.ts"), "utf8");

  assert.ok(hook.includes('"not_interested"'), "hook must support not_interested");
  assert.ok(hook.includes('"hidden"'), "hook must support hidden");
  assert.ok(hook.includes('"dismissed_from_section"'), "hook must support dismissed_from_section");
  assert.ok(hook.includes('method: next ? "POST" : "DELETE"'), "hook must use DELETE to undo feedback");
  assert.ok(hook.includes("surface: resolvedSurface"), "hook must send surface");
  assert.ok(hook.includes("section_key: sectionKey"), "hook must send section_key");
  assert.ok(!hook.includes("user_titles"), "hook must not write user_titles");
  assert.ok(!/favorite\s*:/.test(hook), "hook must not reset favorite");
  assert.ok(!/liked\s*:/.test(hook), "hook must not reset liked");

  assert.ok(button.includes("event.preventDefault()"), "card action must prevent default navigation");
  assert.ok(button.includes("event.stopPropagation()"), "card action must stop propagation");

  assert.ok(titleActions.includes('/api/user/feedback'), "TitleActions preferences must use feedback endpoint");
  assert.ok(titleActions.includes('command: action'), "TitleActions must send feedback commands");
  assert.ok(titleActions.includes('"clear_like"'), "TitleActions must support clear_like");
  assert.ok(!/status\s*\?\?\s*\([^)]*watched/.test(titleActions), "TitleActions must not mark watched for like/favorite");
  assert.ok(!/favorite:\s*false,\s*liked:\s*null/.test(userTitleService), "user-title-service must not reset favorite/liked");
  assert.ok(
    libraryRoute.includes('Object.prototype.hasOwnProperty.call(body, "liked")'),
    "library route must preserve liked when omitted",
  );
  assert.ok(
    libraryRoute.includes('Object.prototype.hasOwnProperty.call(body, "favorite")'),
    "library route must preserve favorite when omitted",
  );
}

function feedbackRows(tmdbId: number, types: FeedbackType[]): UserTitleFeedback[] {
  return types.map((type) => ({
    id: `feedback:${tmdbId}:${type}`,
    user_id: USER_ID,
    tmdb_id: tmdbId,
    media_type: "movie",
    feedback_type: type,
    weight: type === "not_interested" ? -70 : -45,
    reason: null,
    source: null,
    active: true,
    created_at: NOW,
    updated_at: NOW,
  }));
}

async function main() {
  checkMigration();
  checkPolicyPreview();
  await checkApplyTitleFeedbackWithMigratedSchema();
  await checkLegacyFallback();
  checkEndpointSource();
  checkHookAndCardSource();
  console.log("feedback engine migration/engine checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

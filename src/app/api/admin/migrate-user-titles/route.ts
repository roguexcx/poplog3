/**
 * POST /api/admin/migrate-user-titles
 *
 * Migração única de dados: copia poplog3_user_titles → user_titles e
 * reconstrói user_title_state para todos os usuários afetados.
 *
 * Executa apenas com header x-admin-secret correto.
 *
 * Idempotente: usa ON CONFLICT DO NOTHING para não sobrescrever entradas
 * já existentes em user_titles (que são mais recentes — escritas pelo client).
 *
 * Após rodar, user_title_state será recomputado para qualquer título que
 * esteja em poplog3_user_titles mas não estava em user_title_state.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/server/supabase/admin";
import { upsertTitleState } from "@/server/state/user-title-state";

type MediaType = "movie" | "tv";

type LegacyRow = {
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  status: string;
  liked: boolean | null;
  favorite: boolean;
  watched_at?: string | null;
  created_at: string;
};

export async function POST(request: Request) {
  const adminSecret = request.headers.get("x-admin-secret");
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 1. Lê todos os dados de poplog3_user_titles
  const { data: legacyRows, error: readError } = await supabaseAdmin
    .from("poplog3_user_titles")
    .select("user_id, tmdb_id, media_type, status, liked, favorite, created_at");

  if (readError) {
    return NextResponse.json({ ok: false, error: readError.message }, { status: 500 });
  }

  const rows = (legacyRows ?? []) as LegacyRow[];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, migrated: 0, skipped: 0, stateRefreshed: 0 });
  }

  // 2. Para cada linha, insere em user_titles se não existir entrada com mesmo
  //    user_id + tmdb_id + media_type. Preserva dados mais recentes do cliente.
  const existingCheck = await supabaseAdmin
    .from("user_titles")
    .select("user_id, tmdb_id, media_type")
    .in("user_id", [...new Set(rows.map((r) => r.user_id))]);

  const existingSet = new Set(
    ((existingCheck.data ?? []) as Array<{ user_id: string; tmdb_id: number; media_type: string }>)
      .map((r) => `${r.user_id}:${r.tmdb_id}:${r.media_type}`)
  );

  const toInsert = rows.filter(
    (r) => !existingSet.has(`${r.user_id}:${r.tmdb_id}:${r.media_type}`)
  );

  let migrated = 0;
  let insertErrors = 0;
  let firstInsertError: string | null = null;

  // Insere em batches de 200 para não sobrecarregar
  const BATCH = 200;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH).map((r) => ({
      user_id: r.user_id,
      tmdb_id: r.tmdb_id,
      media_type: r.media_type,
      status: r.status,
      liked: r.liked ?? null,
      favorite: r.favorite ?? false,
      watched_at: r.status === "watched" ? r.created_at : null,
      created_at: r.created_at,
    }));

    const { error: insertError } = await supabaseAdmin
      .from("user_titles")
      .insert(batch);

    if (insertError) {
      console.error("[migrate-user-titles] batch insert error:", insertError.message);
      if (!firstInsertError) firstInsertError = insertError.message;
      insertErrors += batch.length;
    } else {
      migrated += batch.length;
    }
  }

  // 3. Reconstrói user_title_state para todos os títulos migrados
  //    (os que existiam só em poplog3_user_titles e não tinham state)
  const stateCheck = await supabaseAdmin
    .from("user_title_state")
    .select("user_id, tmdb_id, media_type")
    .in("user_id", [...new Set(rows.map((r) => r.user_id))]);

  const stateSet = new Set(
    ((stateCheck.data ?? []) as Array<{ user_id: string; tmdb_id: number; media_type: string }>)
      .map((r) => `${r.user_id}:${r.tmdb_id}:${r.media_type}`)
  );

  const needsState = rows.filter(
    (r) => !stateSet.has(`${r.user_id}:${r.tmdb_id}:${r.media_type}`)
  );

  let stateRefreshed = 0;
  let stateErrors = 0;

  for (const row of needsState) {
    try {
      await upsertTitleState({
        userId: row.user_id,
        tmdbId: row.tmdb_id,
        mediaType: row.media_type,
        libraryEntry: {
          status: row.status,
          favorite: row.favorite,
          liked: row.liked,
        },
        event: { type: "status_changed", payload: { status: row.status, source: "migration" } },
      });
      stateRefreshed++;
    } catch (err) {
      console.error("[migrate-user-titles] upsertTitleState failed:", err);
      stateErrors++;
    }

    // Pausa mínima para não saturar a DB em migrações grandes
    if (stateRefreshed % 50 === 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  return NextResponse.json({
    ok: insertErrors === 0 && stateErrors === 0,
    total_legacy: rows.length,
    already_in_user_titles: rows.length - toInsert.length,
    migrated,
    insert_errors: insertErrors,
    first_insert_error: firstInsertError,
    state_already_existed: rows.length - needsState.length,
    state_refreshed: stateRefreshed,
    state_errors: stateErrors,
  });
}

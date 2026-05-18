import { NextResponse } from "next/server";

import { withOrigin } from "@/server/engine-logger";
import { syncTmdbTitle } from "@/server/sync/sync-tmdb-title";
import { supabaseAdmin } from "@/server/supabase/admin";

type MediaType = "movie" | "tv";

type LibraryItemToHydrate = {
  tmdb_id: number;
  media_type: MediaType;
  reason: "no-title" | "no-poster" | "no-backdrop" | "all";
};

type HydrateRow = {
  tmdb_id: number | string | null;
  media_type: string | null;
  title:
    | {
        title?: string | null;
        poster_path?: string | null;
        backdrop_path?: string | null;
      }
    | Array<{
        title?: string | null;
        poster_path?: string | null;
        backdrop_path?: string | null;
      }>
    | null;
};

function isMediaType(value: unknown): value is MediaType {
  return value === "movie" || value === "tv";
}

function asObject<T extends object>(
  value: T | T[] | null | undefined
): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Re-lê a row recém-sincronizada do banco para confirmar o estado REAL —
 * em vez de confiar só no objeto em memória que veio do sync. Isso evita
 * o falso positivo que aconteceu antes (sync afirma sucesso, banco continua
 * com poster null).
 */
async function fetchPersistedState(
  mediaType: MediaType,
  tmdbId: number
): Promise<{ poster_path: string | null; backdrop_path: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from("poplog3_titles")
    .select("poster_path,backdrop_path")
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .maybeSingle();

  if (error || !data) return null;
  return {
    poster_path: data.poster_path ?? null,
    backdrop_path: data.backdrop_path ?? null,
  };
}

export async function POST(request: Request) {
  return withOrigin("admin", async () => {
  const adminSecret = request.headers.get("x-admin-secret");

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const onlyMissingImages =
    url.searchParams.get("onlyMissingImages") === "true";

  const { data: userTitlesData, error } = await supabaseAdmin
    .from("user_titles")
    .select("tmdb_id, media_type");

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  const userTitlesRaw = (userTitlesData ?? []) as Array<{ tmdb_id: number; media_type: string }>;
  const tmdbIds = [...new Set(userTitlesRaw.map((r) => r.tmdb_id))];
  const mediaTypes = [...new Set(userTitlesRaw.map((r) => r.media_type))];

  const titleMetaMap = new Map<string, { title?: string | null; poster_path?: string | null; backdrop_path?: string | null }>();
  if (tmdbIds.length > 0) {
    const { data: titlesData } = await supabaseAdmin
      .from("poplog3_titles")
      .select("tmdb_id, media_type, title, poster_path, backdrop_path")
      .in("tmdb_id", tmdbIds)
      .in("media_type", mediaTypes);

    for (const t of (titlesData ?? []) as Array<{ tmdb_id: number; media_type: string; title: string | null; poster_path: string | null; backdrop_path: string | null }>) {
      titleMetaMap.set(`${t.media_type}:${t.tmdb_id}`, { title: t.title, poster_path: t.poster_path, backdrop_path: t.backdrop_path });
    }
  }

  const rows: HydrateRow[] = userTitlesRaw.map((r) => ({
    tmdb_id: r.tmdb_id,
    media_type: r.media_type,
    title: titleMetaMap.get(`${r.media_type}:${r.tmdb_id}`) ?? null,
  }));

  const missing: LibraryItemToHydrate[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const tmdbId = Number(row.tmdb_id);
    const mediaType = row.media_type;

    if (!Number.isFinite(tmdbId) || !isMediaType(mediaType)) continue;

    const key = `${mediaType}:${tmdbId}`;
    if (seen.has(key)) continue;

    const title = asObject(row.title);
    const noTitleRecord = !title;
    const noTitleString = !title?.title;
    const noPoster = !title?.poster_path;
    const noBackdrop = !title?.backdrop_path;

    if (onlyMissingImages) {
      if (!noPoster && !noBackdrop && !noTitleRecord) continue;
    } else {
      if (!noTitleRecord && !noTitleString && !noPoster && !noBackdrop) continue;
    }

    seen.add(key);

    const reason: LibraryItemToHydrate["reason"] = noTitleRecord
      ? "all"
      : noPoster
        ? "no-poster"
        : noBackdrop
          ? "no-backdrop"
          : "no-title";

    missing.push({ tmdb_id: tmdbId, media_type: mediaType, reason });
  }

  type ResultEntry = {
    tmdb_id: number;
    media_type: MediaType;
    reason: LibraryItemToHydrate["reason"];
    ok: boolean;
    /** Status REAL no banco depois do sync. */
    db_poster: string | null;
    db_backdrop: string | null;
    has_poster_in_db: boolean;
    has_backdrop_in_db: boolean;
    /** Status do upsert (skipped/ok/falha) — fonte da verdade do passo intermediário. */
    persistence_ok?: boolean;
    persistence_skipped?: string;
    error?: string;
  };

  const results: ResultEntry[] = [];

  for (const item of missing) {
    let resultEntry: ResultEntry;

    try {
      const syncResult = await syncTmdbTitle(
  item.media_type,
  item.tmdb_id,
  {
    force: true,
  },
);

      // Não confiamos só no objeto em memória — relemos do banco.
      const persistedState = await fetchPersistedState(
        item.media_type,
        item.tmdb_id
      );

      resultEntry = {
        tmdb_id: item.tmdb_id,
        media_type: item.media_type,
        reason: item.reason,
        ok: true,
        db_poster: persistedState?.poster_path ?? null,
        db_backdrop: persistedState?.backdrop_path ?? null,
        has_poster_in_db: Boolean(persistedState?.poster_path),
        has_backdrop_in_db: Boolean(persistedState?.backdrop_path),
        persistence_ok: syncResult.persistence?.ok,
        persistence_skipped: syncResult.persistence?.skipped,
      };
    } catch (err) {
      const persistedState = await fetchPersistedState(
        item.media_type,
        item.tmdb_id
      );

      resultEntry = {
        tmdb_id: item.tmdb_id,
        media_type: item.media_type,
        reason: item.reason,
        ok: false,
        db_poster: persistedState?.poster_path ?? null,
        db_backdrop: persistedState?.backdrop_path ?? null,
        has_poster_in_db: Boolean(persistedState?.poster_path),
        has_backdrop_in_db: Boolean(persistedState?.backdrop_path),
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }

    results.push(resultEntry);

    // Pausa curta — respeita rate-limit do TMDB.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const failed = results.filter((r) => !r.ok);
  const stillMissingPoster = results.filter(
    (r) => r.ok && !r.has_poster_in_db
  );
  const stillMissingBackdrop = results.filter(
    (r) => r.ok && !r.has_backdrop_in_db
  );

  return NextResponse.json({
    ok: failed.length === 0,
    mode: onlyMissingImages ? "onlyMissingImages" : "all",
    total: rows.length,
    missing: missing.length,
    hydrated: results.filter((r) => r.ok && r.has_poster_in_db).length,
    still_missing_poster: stillMissingPoster.length,
    still_missing_backdrop: stillMissingBackdrop.length,
    failed: failed.length,
    /**
     * Itens onde a TMDB realmente não tem imagem — esses são casos legítimos
     * pro fallback visual. Lista-os para o operador decidir.
     */
    legitimate_no_poster: stillMissingPoster.map((r) => ({
      tmdb_id: r.tmdb_id,
      media_type: r.media_type,
    })),
    legitimate_no_backdrop: stillMissingBackdrop.map((r) => ({
      tmdb_id: r.tmdb_id,
      media_type: r.media_type,
    })),
    results,
  });
  }); // withOrigin("admin")
}

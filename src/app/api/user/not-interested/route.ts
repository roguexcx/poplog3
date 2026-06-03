import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/server/supabase/server";
import { isLocalFeedbackEnabled } from "@/server/runtime/local-db-flags";
import { getCachedTitleRow, getUserActiveFeedbackMap } from "@/server/repositories";
import type { MediaType } from "@/types/user";

type FeedbackRow = {
  tmdb_id: number;
  media_type: MediaType;
  source: string | null;
  reason: string | null;
  updated_at: string;
  created_at: string;
};

type TitleRow = {
  tmdb_id: number;
  media_type: MediaType;
  title: string | null;
  original_title: string | null;
  release_date: string | null;
  first_air_date: string | null;
};

function fallbackTitle(tmdbId: number, mediaType: MediaType) {
  return `${mediaType === "tv" ? "Série" : "Filme"} #${tmdbId}`;
}

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/server/supabase/admin");
  return supabaseAdmin;
}

async function readLocalNotInterestedItems(userId: string) {
  const result = await getUserActiveFeedbackMap(userId);
  if (!result.ok) throw new Error(result.error);

  const feedback = Array.from(result.data.values())
    .flat()
    .filter((row) => row.feedbackType === "not_interested")
    .map((row) => ({
      tmdb_id: row.tmdbId,
      media_type: row.mediaType,
      source: row.source,
      reason: row.reason,
      updated_at: row.updatedAt.toISOString(),
      created_at: row.createdAt.toISOString(),
    } satisfies FeedbackRow));

  return Promise.all(
    feedback.map(async (item) => {
      const title = await getCachedTitleRow(item.media_type, item.tmdb_id);
      const year =
        title?.releaseDate?.toISOString().slice(0, 4) ??
        title?.firstAirDate?.toISOString().slice(0, 4) ??
        null;

      return {
        tmdbId: item.tmdb_id,
        mediaType: item.media_type,
        title: title?.title ?? fallbackTitle(item.tmdb_id, item.media_type),
        originalTitle: title?.originalTitle ?? null,
        year,
        source: item.source,
        reason: item.reason,
        updatedAt: item.updated_at,
        createdAt: item.created_at,
      };
    }),
  );
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ ok: false, error: "Sessao obrigatoria." }, { status: 401 });

  if (isLocalFeedbackEnabled()) {
    try {
      const items = await readLocalNotInterestedItems(user.id);
      return NextResponse.json({ ok: true, count: items.length, items });
    } catch (error) {
      console.error("[not-interested] local feedback read failed", error);
      return NextResponse.json({ ok: false, error: "Nao foi possivel carregar os titulos." }, { status: 500 });
    }
  }

  const { data: feedbackRows, error } = await supabase
    .from("user_title_feedback")
    .select("tmdb_id, media_type, source, reason, updated_at, created_at")
    .eq("user_id", user.id)
    .eq("feedback_type", "not_interested")
    .eq("active", true)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[not-interested] feedback read failed", error);
    return NextResponse.json({ ok: false, error: "Nao foi possivel carregar os titulos." }, { status: 500 });
  }

  const feedback = (feedbackRows ?? []) as FeedbackRow[];
  const tmdbIds = Array.from(new Set(feedback.map((item) => item.tmdb_id)));
  const titleMap = new Map<string, TitleRow>();

  if (tmdbIds.length > 0) {
    const { data: titles, error: titleError } = await (await getSupabaseAdmin())
      .from("poplog3_titles")
      .select("tmdb_id, media_type, title, original_title, release_date, first_air_date")
      .in("tmdb_id", tmdbIds);

    if (titleError) {
      console.warn("[not-interested] title cache read failed", titleError.message);
    }

    for (const title of (titles ?? []) as TitleRow[]) {
      titleMap.set(`${title.media_type}:${title.tmdb_id}`, title);
    }
  }

  const items = feedback.map((item) => {
    const title = titleMap.get(`${item.media_type}:${item.tmdb_id}`);
    const year = title?.release_date?.slice(0, 4) ?? title?.first_air_date?.slice(0, 4) ?? null;

    return {
      tmdbId: item.tmdb_id,
      mediaType: item.media_type,
      title: title?.title ?? fallbackTitle(item.tmdb_id, item.media_type),
      originalTitle: title?.original_title ?? null,
      year,
      source: item.source,
      reason: item.reason,
      updatedAt: item.updated_at,
      createdAt: item.created_at,
    };
  });

  return NextResponse.json({ ok: true, count: items.length, items });
}

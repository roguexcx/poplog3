import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
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

function fallbackTitle(tmdbId: number, mediaType: MediaType) {
  return `${mediaType === "tv" ? "Série" : "Filme"} #${tmdbId}`;
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
  const user = await getCurrentUser();

  if (!user) return NextResponse.json({ ok: false, error: "Sessao obrigatoria." }, { status: 401 });

  try {
    const items = await readLocalNotInterestedItems(user.id);
    return NextResponse.json({ ok: true, count: items.length, items });
  } catch (error) {
    console.error("[not-interested] local feedback read failed", error);
    return NextResponse.json({ ok: false, error: "Nao foi possivel carregar os titulos." }, { status: 500 });
  }
}

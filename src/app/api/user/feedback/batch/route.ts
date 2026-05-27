import { NextResponse } from "next/server";

import {
  getUserFeedbackMap,
  getTitleFeedbackState,
  isMediaType,
} from "@/lib/personalization/feedback";
import { createSupabaseServerClient } from "@/server/supabase/server";
import type { MediaType } from "@/types/user";

const MAX_ITEMS = 60;

type BatchItem = { tmdb_id: unknown; media_type: unknown };

function parseItems(
  raw: unknown,
): Array<{ tmdbId: number; mediaType: MediaType }> {
  if (!Array.isArray(raw)) return [];

  const parsed: Array<{ tmdbId: number; mediaType: MediaType }> = [];
  for (const item of raw as BatchItem[]) {
    const tmdbId = Number(item?.tmdb_id);
    const mediaType = item?.media_type;
    if (Number.isInteger(tmdbId) && tmdbId > 0 && isMediaType(mediaType)) {
      parsed.push({ tmdbId, mediaType });
    }
  }
  return parsed.slice(0, MAX_ITEMS);
}

/**
 * POST /api/user/feedback/batch
 * Body: { items: Array<{ tmdb_id: number; media_type: "movie" | "tv" }> }
 * Response: { results: Record<"movie:123" | "tv:456", TitleFeedbackState> }
 *
 * Substitui N chamadas individuais GET /api/user/feedback?tmdb_id=...
 * por uma única query no banco — carrega todos os feedbacks do usuário
 * de uma vez e resolve os estados localmente.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { items?: unknown };
  const items = parseItems(body?.items);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sem autenticação: devolve estados neutros para todos os itens solicitados
  if (!user) {
    const results: Record<string, { notInterested: boolean; activeFeedbackTypes: string[] }> = {};
    for (const { tmdbId, mediaType } of items) {
      results[`${mediaType}:${tmdbId}`] = { notInterested: false, activeFeedbackTypes: [] };
    }
    return NextResponse.json({ results });
  }

  if (items.length === 0) {
    return NextResponse.json({ results: {} });
  }

  // Uma única query carrega todos os feedbacks ativos do usuário
  const feedbackMap = await getUserFeedbackMap(user.id, supabase);

  const results: Record<string, ReturnType<typeof getTitleFeedbackState>> = {};
  for (const { tmdbId, mediaType } of items) {
    const key = `${mediaType}:${tmdbId}`;
    results[key] = getTitleFeedbackState(feedbackMap, tmdbId, mediaType);
  }

  return NextResponse.json({ results });
}

import { NextResponse } from "next/server";

import {
  getUserFeedbackMap,
  getTitleFeedbackState,
  isMediaType,
} from "@/lib/personalization/feedback";
import { getCurrentUser } from "@/server/auth/get-current-user";
import type { MediaType } from "@/types/user";

const MAX_ITEMS = 60;
const AUTH_TIMEOUT_MS = 700;

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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

function neutralResults(items: Array<{ tmdbId: number; mediaType: MediaType }>) {
  const results: Record<string, { notInterested: boolean; activeFeedbackTypes: string[] }> = {};
  for (const { tmdbId, mediaType } of items) {
    results[`${mediaType}:${tmdbId}`] = { notInterested: false, activeFeedbackTypes: [] };
  }
  return results;
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

  if (items.length === 0) {
    return NextResponse.json({ results: {} });
  }

  const { user, timedOut } = await withTimeout(
    getCurrentUser().then((user) => ({ user, timedOut: false })),
    AUTH_TIMEOUT_MS,
    { user: null, timedOut: true },
  );

  // Sem autenticação: devolve estados neutros para todos os itens solicitados
  if (!user || timedOut) {
    return NextResponse.json({ results: neutralResults(items), skipped: timedOut ? "auth_timeout" : "anonymous" });
  }

  // Uma única query carrega todos os feedbacks ativos do usuário
  const feedbackMap = await getUserFeedbackMap(user.id);

  const results: Record<string, ReturnType<typeof getTitleFeedbackState>> = {};
  for (const { tmdbId, mediaType } of items) {
    const key = `${mediaType}:${tmdbId}`;
    results[key] = getTitleFeedbackState(feedbackMap, tmdbId, mediaType);
  }

  return NextResponse.json({ results });
}

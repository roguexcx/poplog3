/**
 * POST /api/trakt-cache-reset
 *
 * Invalida todos os caches de trending POPLOG (Trakt Index + home_trending).
 * Não remove dados de usuário (watchlist, histórico, avaliações).
 *
 * Protegido por TRAKT_CACHE_RESET_SECRET — não expor publicamente.
 *
 * Body (JSON):
 *   { "secret": "<TRAKT_CACHE_RESET_SECRET>" }
 *
 * Response:
 *   { ok, scope, keysReset, errors, ms, algorithmVersion }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  resetPoplogTrendingCaches,
  POPLOG_TRENDING_ALGORITHM_VERSION,
} from "@/lib/trakt-index/canonical";

export async function POST(request: NextRequest) {
  const secret = process.env.TRAKT_CACHE_RESET_SECRET;

  // Aceita requisições sem secret em desenvolvimento local
  if (secret) {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    if (body.secret !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  console.log("[trakt-cache-reset] reset requested");

  const result = await resetPoplogTrendingCaches({
    scope: "trending-daily",
    preserveUserData: true,
    includePersistentCache: true,
  });

  return NextResponse.json({
    ...result,
    algorithmVersion: POPLOG_TRENDING_ALGORITHM_VERSION,
  });
}

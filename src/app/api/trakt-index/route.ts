/**
 * GET /api/trakt-index
 *
 * Retorna o TOP 50 POPLOG calculado pelos 7 sinais públicos da Trakt.
 * Usado como fonte primária de trending pelo Hero da HOME,
 * pelo bloco "Em alta agora" e pela Home da página Buscar.
 *
 * Query params:
 *   fresh    "1" para ignorar cache e rebuscar
 */

import { NextRequest, NextResponse } from "next/server";
import { isTraktIndexEnabled } from "@/lib/trakt-index/engine";
import {
  getPoplogDailyTrendingIndex,
  POPLOG_TRENDING_ALGORITHM_VERSION,
} from "@/lib/trakt-index/canonical";

export async function GET(request: NextRequest) {
  const startedAt = Date.now();

  if (!isTraktIndexEnabled()) {
    return NextResponse.json(
      { ok: false, error: "trakt_index_disabled", results: [] },
      { status: 503 },
    );
  }

  const fresh = request.nextUrl.searchParams.get("fresh") === "1";

  try {
    const results = await getPoplogDailyTrendingIndex({ fresh });

    if (results.length === 0) {
      console.warn(
        "[trakt-index/route] empty period=daily ms=%d",
        Date.now() - startedAt,
      );
      return NextResponse.json(
        { ok: false, error: "empty_result", results: [] },
        { status: 502 },
      );
    }

    console.log(
      "[trakt-index/route] period=daily items=%d ms=%d",
      results.length,
      Date.now() - startedAt,
    );

    return NextResponse.json({
      ok: true,
      period: "daily",
      algorithmVersion: POPLOG_TRENDING_ALGORITHM_VERSION,
      count: results.length,
      generatedAt: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error("[trakt-index/route] error", error);
    return NextResponse.json(
      { ok: false, error: "internal_error", results: [] },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { computeUserSeriesProgress } from "@/server/episodes/episode-progress-service";

export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const resolved = await params;
  const seriesId = Number(resolved.id);
  if (!seriesId || Number.isNaN(seriesId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid series id" },
      { status: 400 }
    );
  }

  try {
    const progress = await computeUserSeriesProgress(user.id, seriesId);
    return NextResponse.json({ ok: true, progress });
  } catch (err) {
    console.error("[poplog3/series/progress] erro:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Erro inesperado",
      },
      { status: 500 }
    );
  }
}

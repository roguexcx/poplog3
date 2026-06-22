import { NextResponse } from "next/server";

import { drawSorteioItem } from "@/server/sorteio/sorteio-engine";
import { parseSorteioFilters, requireSorteioUser } from "../_shared";

export async function POST(request: Request) {
  try {
    const { user, response } = await requireSorteioUser();
    if (!user) return response;

    const body = await request.json().catch(() => ({}));
    const filters = parseSorteioFilters(body as Record<string, unknown>);
    const result = await drawSorteioItem(user.id, filters);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[SORTEIO_DRAW_ERROR]", error);
    return NextResponse.json({ error: "Falha ao sortear título." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { buildSorteioPool } from "@/server/sorteio/sorteio-engine";
import { parseSorteioFilters, requireSorteioUser } from "../_shared";

export async function GET(request: NextRequest) {
  try {
    const { user, response } = await requireSorteioUser();
    if (!user) return response;

    const filters = parseSorteioFilters(request.nextUrl.searchParams);
    const pool = await buildSorteioPool(user.id, filters);

    return NextResponse.json({
      success: true,
      data: {
        items: pool.items.slice(0, 24),
        meta: pool.meta,
      },
    });
  } catch (error) {
    console.error("[SORTEIO_POOL_ERROR]", error);
    return NextResponse.json({ error: "Falha ao montar pool do sorteio." }, { status: 500 });
  }
}

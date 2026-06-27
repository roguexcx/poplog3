import { NextResponse } from "next/server";

import {
  buildSorteioPool,
  logSorteioDraw,
  pickWeightedSorteioItem,
  type SorteioPoolResult,
} from "@/server/sorteio/sorteio-engine";
import { readContinuitySectionCache } from "@/server/continuity/continuity-section-cache";
import { normalizeStreamingRegion } from "@/server/streaming/region";
import { parseSorteioFilters, requireSorteioUser, sorteioSectionKey } from "../_shared";

type SorteioPoolCachePayload = {
  response: {
    items: SorteioPoolResult["items"];
    meta: SorteioPoolResult["meta"];
  };
  generatedAt: string;
};

export async function POST(request: Request) {
  try {
    const { user, response } = await requireSorteioUser();
    if (!user) return response;

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const filters = parseSorteioFilters(body as Record<string, unknown>);
    const cookieRegion = request instanceof Request
      ? request.headers.get("cookie")?.match(/(?:^|; )poplog_region=([^;]+)/)?.[1]
      : null;
    const cookieLanguage = request instanceof Request
      ? request.headers.get("cookie")?.match(/(?:^|; )poplog_catalog_language=([^;]+)/)?.[1]
      : null;
    const region = normalizeStreamingRegion(
      typeof body.region === "string" ? body.region : cookieRegion ? decodeURIComponent(cookieRegion) : null,
      {
      source: "api:sorteio-draw:region",
      explicit: typeof body.region === "string" || Boolean(cookieRegion),
      },
    );
    const language = typeof body.language === "string"
      ? body.language
      : cookieLanguage ? decodeURIComponent(cookieLanguage) : "pt-BR";
    const key = sorteioSectionKey(filters, { region, language });

    const cached = await readContinuitySectionCache<SorteioPoolCachePayload>(key, {
      userId: user.id,
      region,
      language,
    });

    if ((cached?.status === "hit" || cached?.status === "stale") && cached.payload.response.items.length > 0) {
      const item = pickWeightedSorteioItem(cached.payload.response.items);
      if (item) await logSorteioDraw(user.id, item, cached.payload.response.meta);
      return NextResponse.json({
        success: true,
        data: { item: item ?? null, meta: cached.payload.response.meta },
        cacheStatus: `persistent_${cached.status}`,
        externalCalls: 0,
      });
    }

    const localPool = await buildSorteioPool(user.id, filters, {
      externalDiscovery: false,
      warmAvailability: false,
      catalogLanguage: language,
    });
    const item = pickWeightedSorteioItem(localPool.items);
    if (item) await logSorteioDraw(user.id, item, localPool.meta);

    return NextResponse.json({
      success: true,
      data: { item: item ?? null, meta: localPool.meta },
      cacheStatus: "persistent_miss_local_db",
      externalCalls: 0,
    });
  } catch (error) {
    console.error("[SORTEIO_DRAW_ERROR]", error);
    return NextResponse.json({ error: "Falha ao sortear título." }, { status: 500 });
  }
}

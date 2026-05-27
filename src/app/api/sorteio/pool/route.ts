import { NextRequest, NextResponse } from "next/server";

import { buildSorteioPool, type SorteioPoolResult } from "@/server/sorteio/sorteio-engine";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";
import { parseSorteioFilters, requireSorteioUser } from "../_shared";

type SorteioPoolResponse = {
  items: SorteioPoolResult["items"];
  meta: SorteioPoolResult["meta"];
};

type SorteioPoolCachePayload = {
  response: SorteioPoolResponse;
  generatedAt: string;
};

const SORTEIO_POOL_CACHE_TTL_MS = 30 * 60_000;
const DEFAULT_REGION = "BR";
const DEFAULT_LANGUAGE = "pt-BR";
const refreshes = new Map<string, Promise<void>>();

function markStage(perf: Record<string, number>, stageRef: { value: number }, stage: string) {
  perf[stage] = Date.now() - stageRef.value;
  stageRef.value = Date.now();
}

function sectionKey(filters: ReturnType<typeof parseSorteioFilters>) {
  return `sorteio_pool_${filters.mode}_${filters.type}_${filters.vibe}`;
}

async function buildResponse(userId: string, filters: ReturnType<typeof parseSorteioFilters>) {
  const pool = await buildSorteioPool(userId, filters);
  return {
    items: pool.items.slice(0, 24),
    meta: pool.meta,
  } satisfies SorteioPoolResponse;
}

function refreshInBackground(input: {
  userId: string;
  sectionKey: string;
  region: string;
  language: string;
  filters: ReturnType<typeof parseSorteioFilters>;
}) {
  const key = `${input.userId}:${input.sectionKey}:${input.region}:${input.language}`;
  if (refreshes.has(key)) return;

  const promise = (async () => {
    try {
      const response = await buildResponse(input.userId, input.filters);
      await writeContinuitySectionCache({
        sectionKey: input.sectionKey,
        userId: input.userId,
        region: input.region,
        language: input.language,
        ttlMs: SORTEIO_POOL_CACHE_TTL_MS,
        payload: {
          response,
          generatedAt: new Date().toISOString(),
        } satisfies SorteioPoolCachePayload,
      });
    } finally {
      refreshes.delete(key);
    }
  })();

  refreshes.set(key, promise);
}

export async function GET(request: NextRequest) {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = {};
  const stageRef = { value: totalStartedAt };

  try {
    const filters = parseSorteioFilters(request.nextUrl.searchParams);
    const region = request.nextUrl.searchParams.get("region") ?? DEFAULT_REGION;
    const language = request.nextUrl.searchParams.get("language") ?? DEFAULT_LANGUAGE;
    const key = sectionKey(filters);
    markStage(perf, stageRef, "request_parse");

    const { user, response } = await requireSorteioUser();
    if (!user) return response;
    markStage(perf, stageRef, "auth");

    const cached = await readContinuitySectionCache<SorteioPoolCachePayload>(key, {
      userId: user.id,
      region,
      language,
    });
    markStage(perf, stageRef, "cache_read");

    if (cached?.status === "hit") {
      console.log("[sorteio/pool/perf]", {
        cacheStatus: "persistent_hit",
        sectionKey: key,
        returned: cached.payload.response.items.length,
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json({
        success: true,
        data: cached.payload.response,
        cacheStatus: "persistent_hit",
      });
    }

    if (cached?.status === "stale") {
      refreshInBackground({ userId: user.id, sectionKey: key, region, language, filters });
      console.log("[sorteio/pool/perf]", {
        cacheStatus: "persistent_stale",
        sectionKey: key,
        returned: cached.payload.response.items.length,
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json({
        success: true,
        data: cached.payload.response,
        cacheStatus: "persistent_stale",
      });
    }

    const data = await buildResponse(user.id, filters);
    markStage(perf, stageRef, "candidate_pool");

    await writeContinuitySectionCache({
      sectionKey: key,
      userId: user.id,
      region,
      language,
      ttlMs: SORTEIO_POOL_CACHE_TTL_MS,
      payload: {
        response: data,
        generatedAt: new Date().toISOString(),
      } satisfies SorteioPoolCachePayload,
    });
    markStage(perf, stageRef, "cache_write");

    console.log("[sorteio/pool/perf]", {
      cacheStatus: "persistent_miss",
      sectionKey: key,
      returned: data.items.length,
      filters,
      ...perf,
      total: Date.now() - totalStartedAt,
    });

    return NextResponse.json({
      success: true,
      data,
      cacheStatus: "persistent_miss",
    });
  } catch (error) {
    console.error("[SORTEIO_POOL_ERROR]", error);
    return NextResponse.json({ error: "Falha ao montar pool do sorteio." }, { status: 500 });
  }
}

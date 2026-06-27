import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getUserFeedbackMap } from "@/lib/personalization/feedback";
import { applyUserFeedbackScoring } from "@/lib/personalization/scoring";
import { getTrendingFeed, withTimeout } from "@/features/home/trending-feed";
import { resolveLocaleScope } from "@/server/source-engine/locale";
import { buildTrendingV2Response, type TrendingV2Source } from "@/lib/trending/trending-contract";

const TRENDING_AUTH_TIMEOUT_MS = 500;

function markStage(perf: Record<string, number>, stageRef: { value: number }, stage: string) {
  perf[stage] = Date.now() - stageRef.value;
  stageRef.value = Date.now();
}

async function resolveUserFeedback() {
  let userId: string | undefined;
  let feedbackMap: Awaited<ReturnType<typeof getUserFeedbackMap>> | undefined;

  await withTimeout((async () => {
    const user = await getCurrentUser();
    if (user) {
      userId = user.id;
      feedbackMap = await getUserFeedbackMap(user.id);
    }
  })().catch(() => undefined), TRENDING_AUTH_TIMEOUT_MS, undefined);

  return { userId, feedbackMap };
}

export async function GET(request: NextRequest) {
  const debugSource = request.nextUrl.searchParams.get("debugSource") === "1";
  const includeProviders = request.nextUrl.searchParams.get("includeProviders") !== "0";
  const fast = request.nextUrl.searchParams.get("fast") === "1";
  const localeScope = resolveLocaleScope({
    language:
      request.nextUrl.searchParams.get("language") ??
      request.nextUrl.searchParams.get("locale") ??
      request.cookies.get("poplog_catalog_language")?.value,
    region: request.nextUrl.searchParams.get("region") ?? request.cookies.get("poplog_region")?.value,
  });
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = { request_parse: 0 };
  const stageRef = { value: totalStartedAt };

  try {
    const { userId, feedbackMap } = await resolveUserFeedback();
    markStage(perf, stageRef, "auth");

    // Fonte única: pipeline canônico compartilhado com o Hero rotativo da Home.
    const feed = await getTrendingFeed({
      fast,
      includeProviders,
      backgroundRefresh: fast,
      language: localeScope.catalogLanguage,
      region: localeScope.region,
      recordStage: (stage) => markStage(perf, stageRef, stage),
    });

    const results = applyUserFeedbackScoring(feed.items, {
      userId,
      feedbackMap,
      context: "trending",
    });
    markStage(perf, stageRef, "response_build");

    // Contrato V2 (idioma, região, fonte, recência, identidade, localized).
    const v2 = buildTrendingV2Response({
      items: results,
      language: localeScope.catalogLanguage,
      region: localeScope.region,
      source: feed.source as TrendingV2Source,
      cacheStatus: feed.cacheStatus,
    });

    console.log("[trending/perf]", {
      cacheStatus: feed.cacheStatus,
      source: feed.source,
      realness: feed.realness,
      returned: results.length,
      ...perf,
      total: Date.now() - totalStartedAt,
    });

    return NextResponse.json({
      ok: true,
      count: results.length,
      language: localeScope.catalogLanguage,
      region: localeScope.region,
      // Transparência de fonte: trending real vs. contingência local.
      source: feed.source,
      realness: feed.realness,
      languageStats: feed.languageStats,
      generatedAt: v2.generatedAt,
      results,
      trendingV2: v2,
      ...(feed.fromCache ? { cacheStatus: feed.cacheReadStatus } : {}),
      ...(debugSource ? { debugSource: feed.debugSource } : {}),
    });
  } catch (error) {
    console.error("[trending route]", error);
    console.log("[trending/perf]", {
      cacheStatus: "error_empty_fallback",
      returned: 0,
      ...perf,
      total: Date.now() - totalStartedAt,
    });
    return NextResponse.json({
      ok: true,
      count: 0,
      results: [],
      skipped: "error_fallback",
    });
  }
}

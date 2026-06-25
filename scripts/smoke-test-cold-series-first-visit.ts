import "dotenv/config";

import assert from "node:assert/strict";

import { getTitlePageData } from "@/server/titles/get-title-page-data";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  process.env.POPLOG_TITLE_COLD_SERIES_SYNC = "false";
  process.env.POPLOG_TITLE_COLD_SEASON_LIST_SYNC = "false";

  const startedAt = performance.now();
  const title = await withTimeout(
    getTitlePageData({
      mediaType: "tv",
      id: "tt0944947",
      country: "BR",
      debugSource: true,
    }),
    Number(process.env.POPLOG_COLD_SERIES_SMOKE_TIMEOUT_MS ?? 12_000),
  );
  const elapsedMs = Math.round(performance.now() - startedAt);

  assert.ok(title, "serie resolvida na primeira visita fria");
  assert.equal(title?.mediaType, "tv", "mediaType tv preservado");
  assert.ok(title?.externalIds?.imdbId || title?.id, "identidade retornada");
  assert.ok((title?.seasons?.length ?? 0) > 0 || (title?.numberOfSeasons ?? 0) > 0, "temporadas ou stubs disponiveis");
  assert.ok(elapsedMs < Number(process.env.POPLOG_COLD_SERIES_SMOKE_MAX_MS ?? 12_000), "visita fria dentro do teto local");

  console.log("[smoke:cold-series] ok", {
    title: title?.title,
    imdbId: title?.externalIds?.imdbId,
    seasons: title?.seasons?.length ?? 0,
    numberOfSeasons: title?.numberOfSeasons ?? null,
    elapsedMs,
  });
}

main().catch((error) => {
  console.error("[smoke:cold-series] failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
